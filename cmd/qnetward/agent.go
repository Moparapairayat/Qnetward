package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

// agentVersion is reported to the console with every heartbeat.
const agentVersion = "0.4.0"

// agentState is what an enrolled agent keeps between runs. The secret is as
// good as a password for this agent, so the file is readable by its owner only.
type agentState struct {
	Server  string `json:"server"`
	AgentID int64  `json:"agent_id"`
	Name    string `json:"name"`
	Secret  string `json:"secret"`
}

type agentClient struct {
	server   string
	http     *http.Client
	hostname string
}

// errAgentRemoved means the console no longer knows this agent.
var errAgentRemoved = errors.New("this agent was removed in the console; enroll it again with a new token")

func runAgent(args []string) {
	fs := flag.NewFlagSet("agent", flag.ExitOnError)
	server := fs.String("server", envString("QNETWARD_AGENT_SERVER", ""), "console URL, such as https://console.qnetward.com")
	token := fs.String("token", envString("QNETWARD_AGENT_TOKEN", ""), "enrollment token from the console (first run only)")
	stateDir := fs.String("state-dir", envString("QNETWARD_AGENT_STATE_DIR", defaultAgentStateDir()), "where the agent keeps its credentials")
	once := fs.Bool("once", false, "enroll if needed, check in once, and exit")
	fs.BoolVar(&agentHostMetrics, "host-metrics", envBool("QNETWARD_AGENT_HOST_METRICS", true), "report this machine's CPU, memory, disk, and network to the console")
	_ = fs.Parse(args)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := agentMain(ctx, *server, *token, *stateDir, *once, os.Stdout); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, "agent:", err)
		os.Exit(1)
	}
}

func defaultAgentStateDir() string {
	if runtime.GOOS == "linux" && os.Geteuid() == 0 {
		return "/var/lib/qnetward-agent"
	}
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "qnetward-agent")
	}
	return ".qnetward-agent"
}

// agentMain enrolls when there are no saved credentials, then checks in on the
// interval the console asks for until ctx ends.
func agentMain(ctx context.Context, server, token, stateDir string, once bool, out io.Writer) error {
	statePath := filepath.Join(stateDir, "agent.json")
	state, err := loadAgentState(statePath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	hostname, _ := os.Hostname()
	if state == nil || (token != "" && server != "") {
		if server == "" || token == "" {
			return fmt.Errorf("not enrolled yet: run with --server and --token from the console")
		}
		c := &agentClient{server: strings.TrimRight(server, "/"), http: &http.Client{Timeout: 20 * time.Second}, hostname: hostname}
		state, err = c.enroll(ctx, token)
		if err != nil {
			return err
		}
		if err := saveAgentState(statePath, state); err != nil {
			return fmt.Errorf("enrolled, but couldn't save credentials to %s: %w", statePath, err)
		}
		fmt.Fprintf(out, "Enrolled as %q. Credentials saved to %s\n", state.Name, statePath)
	}

	c := &agentClient{server: state.Server, http: &http.Client{Timeout: 20 * time.Second}, hostname: hostname}
	if once {
		hb, err := c.heartbeat(ctx, state.Secret)
		if err == nil {
			fmt.Fprintf(out, "Checked in with %s as %q; %d monitors to run\n", state.Server, state.Name, len(hb.Jobs))
		}
		return err
	}

	runner := newJobRunner()
	devices := newDevicePoller()
	deviceCount := -1
	var wg sync.WaitGroup
	defer wg.Wait()
	ctx, stop := context.WithCancel(ctx)
	defer stop()

	// The live link: commands from the console, and live readings back.
	link := newLiveLink(state.Server, state.Secret)
	linkErr := make(chan error, 1)
	go func() { linkErr <- link.run(ctx) }()
	var hostLive liveWindow
	var hostLiveAt time.Time
	var liveHosts *hostCollector
	deviceLive := map[int64]liveWindow{}
	deviceLiveBusy := map[int64]bool{}
	deviceLiveDone := make(chan int64, 8)
	liveTick := time.NewTicker(250 * time.Millisecond)
	defer liveTick.Stop()

	beat := time.NewTimer(0)
	defer beat.Stop()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	flush := time.NewTicker(agentFlushEvery)
	defer flush.Stop()
	jobs := -1
	var hosts *hostCollector
	hostEvery := time.Duration(0)
	sample := time.NewTimer(time.Hour)
	sample.Stop()
	defer sample.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-beat.C:
			interval := 30 * time.Second
			hb, err := c.heartbeat(ctx, state.Secret)
			switch {
			case errors.Is(err, errAgentRemoved):
				return err
			case err != nil:
				fmt.Fprintln(out, "heartbeat failed, retrying:", err)
			default:
				runner.sync(hb.Jobs)
				devices.sync(hb.Devices)
				if n := devices.count(); n != deviceCount {
					if n > 0 || deviceCount > 0 {
						fmt.Fprintf(out, "Polling %d network devices\n", n)
					}
					deviceCount = n
				}
				if n := runner.count(); n != jobs {
					fmt.Fprintf(out, "Running %d monitors\n", n)
					jobs = n
				}
				if hb.HeartbeatSeconds > 0 {
					interval = time.Duration(hb.HeartbeatSeconds) * time.Second
				}
				// The console says how often to sample the host; 0 turns it off.
				every := time.Duration(hb.MetricsSeconds) * time.Second
				if !agentHostMetrics || every < 10*time.Second {
					every = 0
				}
				if every != hostEvery {
					hostEvery = every
					sample.Stop()
					if every > 0 {
						if hosts == nil {
							hosts = newHostCollector()
						}
						sample.Reset(5 * time.Second)
					}
				}
			}
			beat.Reset(interval)
		case err := <-linkErr:
			if errors.Is(err, errAgentRemoved) {
				return err
			}
		case cmd := <-link.commands:
			switch cmd.Type {
			case "sync":
				// Monitors or devices changed: fetch the work list now.
				beat.Reset(0)
			case "run":
				runner.runNow(cmd.MonitorID)
			case "run_device":
				devices.runNow(cmd.DeviceID)
			case "live":
				hostLive = windowFrom(cmd, time.Second)
				if liveHosts == nil {
					liveHosts = newHostCollector()
				}
			case "live_device":
				if _, ok := devices.job(cmd.DeviceID); ok {
					deviceLive[cmd.DeviceID] = windowFrom(cmd, 2*time.Second)
				}
			}
		case id := <-deviceLiveDone:
			delete(deviceLiveBusy, id)
		case now := <-liveTick.C:
			// Live mode: stream this machine while someone has its page open.
			if hostLive.on(now) && now.Sub(hostLiveAt) >= hostLive.every {
				hostLiveAt = now
				_ = link.send(map[string]any{"type": "host_sample", "host": liveHosts.sample(ctx, now)})
			}
			for id, w := range deviceLive {
				if !w.on(now) {
					delete(deviceLive, id)
					continue
				}
				if deviceLiveBusy[id] {
					continue
				}
				job, ok := devices.job(id)
				if !ok {
					delete(deviceLive, id)
					continue
				}
				deviceLiveBusy[id] = true
				wg.Add(1)
				go func(id int64, job deviceJob, every time.Duration) {
					defer wg.Done()
					start := time.Now()
					s := devices.poll(ctx, job)
					_ = link.send(map[string]any{"type": "device_sample", "device": s})
					// Keep to the requested pace even when a poll is quick.
					if rest := every - time.Since(start); rest > 0 {
						select {
						case <-ctx.Done():
						case <-time.After(rest):
						}
					}
					select {
					case deviceLiveDone <- id:
					case <-ctx.Done(): // shutting down: nobody reads it any more
					}
				}(id, job, w.every)
			}
		case <-sample.C:
			hosts.collect(ctx, time.Now())
			if err := hosts.send(ctx, c, state.Secret); errors.Is(err, errAgentRemoved) {
				return err
			} else if err != nil {
				fmt.Fprintln(out, "sending host metrics failed, will retry:", err)
			}
			sample.Reset(hostEvery)
		case <-tick.C:
			runner.startDue(ctx, &wg)
			devices.startDue(ctx, &wg)
		case <-flush.C:
			if err := c.sendResults(ctx, state.Secret, runner); errors.Is(err, errAgentRemoved) {
				return err
			} else if err != nil {
				fmt.Fprintln(out, "sending results failed, will retry:", err)
			}
			if err := c.sendDeviceSamples(ctx, state.Secret, devices); errors.Is(err, errAgentRemoved) {
				return err
			} else if err != nil {
				fmt.Fprintln(out, "sending device samples failed, will retry:", err)
			}
		}
	}
}

// agentHostMetrics turns host metrics on; the --host-metrics flag sets it.
var agentHostMetrics = true

// agentFlushEvery is how often finished checks are sent to the console.
var agentFlushEvery = 5 * time.Second

// sendDeviceSamples sends device polls in batches, keeping any that fail.
func (c *agentClient) sendDeviceSamples(ctx context.Context, secret string, p *devicePoller) error {
	for {
		batch := p.take(20)
		if len(batch) == 0 {
			return nil
		}
		var resp struct {
			Accepted int `json:"accepted"`
		}
		if err := c.post(ctx, "/api/agent/devices", secret, map[string]any{"samples": batch}, &resp); err != nil {
			p.putBack(batch)
			return err
		}
	}
}

// sendResults sends finished checks in batches, keeping any that fail to send.
func (c *agentClient) sendResults(ctx context.Context, secret string, runner *jobRunner) error {
	for {
		batch := runner.take(100)
		if len(batch) == 0 {
			return nil
		}
		var resp struct {
			Accepted int `json:"accepted"`
		}
		if err := c.post(ctx, "/api/agent/results", secret, map[string]any{"results": batch}, &resp); err != nil {
			runner.putBack(batch)
			return err
		}
	}
}

func (c *agentClient) hello(token string) map[string]string {
	return map[string]string{"token": token, "version": agentVersion, "hostname": c.hostname, "platform": runtime.GOOS + "/" + runtime.GOARCH}
}

func (c *agentClient) enroll(ctx context.Context, token string) (*agentState, error) {
	var resp struct {
		AgentID int64  `json:"agent_id"`
		Name    string `json:"name"`
		Secret  string `json:"secret"`
	}
	if err := c.post(ctx, "/api/agent/enroll", "", c.hello(token), &resp); err != nil {
		return nil, fmt.Errorf("enrollment failed: %w", err)
	}
	return &agentState{Server: c.server, AgentID: resp.AgentID, Name: resp.Name, Secret: resp.Secret}, nil
}

// heartbeatReply is the console's answer to a check-in.
type heartbeatReply struct {
	HeartbeatSeconds int         `json:"heartbeat_seconds"`
	MetricsSeconds   int         `json:"metrics_seconds"`
	Jobs             []agentJob  `json:"jobs"`
	Devices          []deviceJob `json:"devices"`
}

func (c *agentClient) heartbeat(ctx context.Context, secret string) (heartbeatReply, error) {
	var resp heartbeatReply
	err := c.post(ctx, "/api/agent/heartbeat", secret, c.hello(""), &resp)
	return resp, err
}

func (c *agentClient) post(ctx context.Context, path, secret string, body, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.server+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "qnetward-agent/"+agentVersion)
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusUnauthorized && secret != "" {
		return errAgentRemoved
	}
	if resp.StatusCode >= 300 {
		var apiErr struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &apiErr) == nil && apiErr.Error != "" {
			return errors.New(apiErr.Error)
		}
		return fmt.Errorf("the console answered %d", resp.StatusCode)
	}
	return json.Unmarshal(data, out)
}

func loadAgentState(path string) (*agentState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s agentState
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("%s is damaged: %w", path, err)
	}
	if s.Server == "" || s.Secret == "" {
		return nil, fmt.Errorf("%s is incomplete; enroll again", path)
	}
	return &s, nil
}

func saveAgentState(path string, s *agentState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

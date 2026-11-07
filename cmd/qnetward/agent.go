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
	"syscall"
	"time"
)

// agentVersion is reported to the console with every heartbeat.
const agentVersion = "0.1.0"

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
	interval := 30 * time.Second
	for {
		next, err := c.heartbeat(ctx, state.Secret)
		switch {
		case errors.Is(err, errAgentRemoved):
			return err
		case err != nil:
			fmt.Fprintln(out, "heartbeat failed, retrying:", err)
		default:
			if next > 0 {
				interval = next
			}
		}
		if once {
			if err == nil {
				fmt.Fprintf(out, "Checked in with %s as %q\n", state.Server, state.Name)
			}
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
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

func (c *agentClient) heartbeat(ctx context.Context, secret string) (time.Duration, error) {
	var resp struct {
		HeartbeatSeconds int `json:"heartbeat_seconds"`
	}
	if err := c.post(ctx, "/api/agent/heartbeat", secret, c.hello(""), &resp); err != nil {
		return 0, err
	}
	return time.Duration(resp.HeartbeatSeconds) * time.Second, nil
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

package store

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrStatusPageNotFound  = errors.New("status page not found")
	ErrStatusPageSlugTaken = errors.New("that address is taken; pick another")
	ErrStatusPageLimit     = errors.New("this workspace has reached its plan's status page limit")
)

// StatusPageDays is how far back a public page shows daily uptime; monitor
// checks are kept for 30 days.
const StatusPageDays = 30

var statusSlug = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`)

// StatusPageMonitor is one monitor on a page, under the name visitors see.
type StatusPageMonitor struct {
	MonitorID int64  `json:"monitor_id"`
	Label     string `json:"label"`
}

// StatusPage is a public page a workspace publishes for its customers.
type StatusPage struct {
	ID          int64               `json:"id"`
	WorkspaceID int64               `json:"-"`
	Slug        string              `json:"slug"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Published   bool                `json:"published"`
	Monitors    []StatusPageMonitor `json:"monitors"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
	// OverPlan is set on lists when the workspace's plan doesn't cover this
	// one, so it waits (see plan_caps.go).
	OverPlan bool `json:"over_plan,omitempty"`
}

func validateStatusPage(p *StatusPage) error {
	if p.WorkspaceID <= 0 {
		return errors.New("workspace is required")
	}
	p.Slug = strings.ToLower(strings.TrimSpace(p.Slug))
	if !statusSlug.MatchString(p.Slug) || strings.Contains(p.Slug, "--") {
		return errors.New("the address needs 3 to 40 lowercase letters, numbers, or single hyphens")
	}
	p.Title = strings.Join(strings.Fields(p.Title), " ")
	if p.Title == "" {
		return errors.New("title is required")
	}
	if len([]rune(p.Title)) > 80 {
		return errors.New("title must be 80 characters or fewer")
	}
	p.Description = strings.TrimSpace(p.Description)
	if len([]rune(p.Description)) > 300 {
		return errors.New("description must be 300 characters or fewer")
	}
	if len(p.Monitors) > 50 {
		return errors.New("a page can show up to 50 monitors")
	}
	seen := map[int64]bool{}
	for i := range p.Monitors {
		m := &p.Monitors[i]
		if seen[m.MonitorID] {
			return errors.New("a monitor can appear only once on a page")
		}
		seen[m.MonitorID] = true
		m.Label = strings.Join(strings.Fields(m.Label), " ")
		if len([]rune(m.Label)) > 60 {
			return errors.New("display names must be 60 characters or fewer")
		}
	}
	return nil
}

const statusPageColumns = `id, workspace_id, slug, title, description, published, created_at, updated_at`

func scanStatusPage(scanner interface{ Scan(...any) error }, p *StatusPage) error {
	return scanner.Scan(&p.ID, &p.WorkspaceID, &p.Slug, &p.Title, &p.Description, &p.Published, &p.CreatedAt, &p.UpdatedAt)
}

// ListStatusPages returns the workspace's pages with their monitors.
func (s *Store) ListStatusPages(ctx context.Context, workspaceID int64) ([]StatusPage, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `SELECT `+statusPageColumns+` FROM status_pages WHERE workspace_id = $1 ORDER BY created_at, id`, workspaceID)
	if err != nil {
		return nil, err
	}
	pages := []StatusPage{}
	index := map[int64]int{}
	for rows.Next() {
		var p StatusPage
		if err := scanStatusPage(rows, &p); err != nil {
			rows.Close()
			return nil, err
		}
		p.Monitors = []StatusPageMonitor{}
		index[p.ID] = len(pages)
		pages = append(pages, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(pages) == 0 {
		return pages, err
	}

	links, err := tx.QueryContext(ctx, `SELECT page_id, monitor_id, label FROM status_page_monitors WHERE workspace_id = $1 ORDER BY page_id, position, monitor_id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer links.Close()
	for links.Next() {
		var pageID int64
		var m StatusPageMonitor
		if err := links.Scan(&pageID, &m.MonitorID, &m.Label); err != nil {
			return nil, err
		}
		if i, ok := index[pageID]; ok {
			pages[i].Monitors = append(pages[i].Monitors, m)
		}
	}
	return pages, links.Err()
}

// SaveStatusPage creates a page, or updates one in the same workspace, and
// replaces its monitors. Monitors from other workspaces are ignored. limit
// caps how many pages the workspace can have; 0 means no cap.
func (s *Store) SaveStatusPage(ctx context.Context, p StatusPage, limit int) (StatusPage, error) {
	if s == nil {
		return StatusPage{}, errors.New("store is not available")
	}
	if err := validateStatusPage(&p); err != nil {
		return StatusPage{}, err
	}
	tx, err := s.beginWorkspaceTx(ctx, p.WorkspaceID)
	if err != nil {
		return StatusPage{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var saved StatusPage
	if p.ID == 0 {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM status_pages WHERE workspace_id = $1`, p.WorkspaceID).Scan(&count); err != nil {
			return StatusPage{}, err
		}
		if limit > 0 && count >= limit {
			return StatusPage{}, ErrStatusPageLimit
		}
		err = scanStatusPage(tx.QueryRowContext(ctx, `
			INSERT INTO status_pages (workspace_id, slug, title, description, published)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING `+statusPageColumns, p.WorkspaceID, p.Slug, p.Title, p.Description, p.Published), &saved)
	} else {
		err = scanStatusPage(tx.QueryRowContext(ctx, `
			UPDATE status_pages SET slug = $3, title = $4, description = $5, published = $6, updated_at = NOW()
			WHERE id = $1 AND workspace_id = $2
			RETURNING `+statusPageColumns, p.ID, p.WorkspaceID, p.Slug, p.Title, p.Description, p.Published), &saved)
	}
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return StatusPage{}, ErrStatusPageNotFound
	case errors.As(err, &pgErr) && pgErr.Code == "23505":
		return StatusPage{}, ErrStatusPageSlugTaken
	case err != nil:
		return StatusPage{}, err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM status_page_monitors WHERE page_id = $1`, saved.ID); err != nil {
		return StatusPage{}, err
	}
	saved.Monitors = []StatusPageMonitor{}
	for i, m := range p.Monitors {
		// The join keeps monitors from other workspaces off the page.
		res, err := tx.ExecContext(ctx, `
			INSERT INTO status_page_monitors (page_id, monitor_id, workspace_id, label, position)
			SELECT $1, id, workspace_id, $3, $4 FROM monitors WHERE id = $2 AND workspace_id = $5
		`, saved.ID, m.MonitorID, m.Label, i, p.WorkspaceID)
		if err != nil {
			return StatusPage{}, err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			saved.Monitors = append(saved.Monitors, m)
		}
	}
	return saved, tx.Commit()
}

// DeleteStatusPage removes a page and returns what it was.
func (s *Store) DeleteStatusPage(ctx context.Context, workspaceID, id int64) (StatusPage, error) {
	if s == nil {
		return StatusPage{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return StatusPage{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var p StatusPage
	err = scanStatusPage(tx.QueryRowContext(ctx, `DELETE FROM status_pages WHERE id = $1 AND workspace_id = $2 RETURNING `+statusPageColumns, id, workspaceID), &p)
	if errors.Is(err, sql.ErrNoRows) {
		return StatusPage{}, ErrStatusPageNotFound
	}
	if err != nil {
		return StatusPage{}, err
	}
	return p, tx.Commit()
}

// StatusDay is one day of a component's history: checks run and how many failed.
type StatusDay struct {
	Date   string `json:"date"`
	Checks int    `json:"checks"`
	Failed int    `json:"failed"`
}

// PublicComponent is a monitor as a public page shows it: its display name
// and outcomes, never its target.
type PublicComponent struct {
	Name          string      `json:"name"`
	Status        string      `json:"status"`
	LastCheckedAt *time.Time  `json:"last_checked_at,omitempty"`
	Days          []StatusDay `json:"days"`
}

// PublicStatusPage is everything a visitor to /status/<slug> sees.
type PublicStatusPage struct {
	Slug        string            `json:"slug"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Components  []PublicComponent `json:"components"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// GetPublicStatusPage reads a published page for anyone, by slug. It runs
// across workspaces as the login role, so it returns only the fields meant
// for the public.
func (s *Store) GetPublicStatusPage(ctx context.Context, slug string) (PublicStatusPage, error) {
	if s == nil {
		return PublicStatusPage{}, errors.New("store is not available")
	}
	slug = strings.ToLower(strings.TrimSpace(slug))
	if !statusSlug.MatchString(slug) {
		return PublicStatusPage{}, ErrStatusPageNotFound
	}
	var pageID int64
	page := PublicStatusPage{Slug: slug, Components: []PublicComponent{}, UpdatedAt: time.Now().UTC()}
	err := s.db.QueryRowContext(ctx, `SELECT id, title, description FROM status_pages WHERE slug = $1 AND published AND `+withinPlanSQL("id", "status_pages", "t.published", statusPageCap), slug).Scan(&pageID, &page.Title, &page.Description)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicStatusPage{}, ErrStatusPageNotFound
	}
	if err != nil {
		return PublicStatusPage{}, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id, COALESCE(NULLIF(l.label, ''), m.name),
			CASE WHEN m.enabled AND `+withinPlanSQL("m.id", "monitors", "t.enabled", monitorCap)+` THEN m.status ELSE 'paused' END, m.last_checked_at
		FROM status_page_monitors l JOIN monitors m ON m.id = l.monitor_id
		WHERE l.page_id = $1
		ORDER BY l.position, m.id
	`, pageID)
	if err != nil {
		return PublicStatusPage{}, err
	}
	index := map[int64]int{}
	ids := []int64{}
	for rows.Next() {
		var id int64
		var c PublicComponent
		var checked sql.NullTime
		if err := rows.Scan(&id, &c.Name, &c.Status, &checked); err != nil {
			rows.Close()
			return PublicStatusPage{}, err
		}
		if checked.Valid {
			t := checked.Time
			c.LastCheckedAt = &t
		}
		c.Days = []StatusDay{}
		index[id] = len(page.Components)
		ids = append(ids, id)
		page.Components = append(page.Components, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(ids) == 0 {
		return page, err
	}

	days, err := s.db.QueryContext(ctx, `
		SELECT monitor_id, to_char(date_trunc('day', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD'), COUNT(*), COUNT(*) FILTER (WHERE NOT ok)
		FROM monitor_checks
		WHERE monitor_id = ANY($1) AND checked_at > NOW() - make_interval(days => $2)
		GROUP BY 1, 2
		ORDER BY 1, 2
	`, ids, StatusPageDays)
	if err != nil {
		return PublicStatusPage{}, err
	}
	defer days.Close()
	for days.Next() {
		var id int64
		var d StatusDay
		if err := days.Scan(&id, &d.Date, &d.Checks, &d.Failed); err != nil {
			return PublicStatusPage{}, err
		}
		if i, ok := index[id]; ok {
			page.Components[i].Days = append(page.Components[i].Days, d)
		}
	}
	return page, days.Err()
}

// StatusPageScope is what a public page's live stream needs to know: whose
// events to watch, and which monitors (with their status) the page shows.
type StatusPageScope struct {
	WorkspaceID int64
	Monitors    map[int64]string
}

// PublicStatusPageScope reads a published page's workspace and monitors, for
// its live stream. It runs as the login role, like GetPublicStatusPage, and
// never leaves the server.
func (s *Store) PublicStatusPageScope(ctx context.Context, slug string) (StatusPageScope, error) {
	if s == nil {
		return StatusPageScope{}, errors.New("store is not available")
	}
	slug = strings.ToLower(strings.TrimSpace(slug))
	if !statusSlug.MatchString(slug) {
		return StatusPageScope{}, ErrStatusPageNotFound
	}
	scope := StatusPageScope{Monitors: map[int64]string{}}
	var pageID int64
	err := s.db.QueryRowContext(ctx, `SELECT id, workspace_id FROM status_pages WHERE slug = $1 AND published`, slug).Scan(&pageID, &scope.WorkspaceID)
	if errors.Is(err, sql.ErrNoRows) {
		return StatusPageScope{}, ErrStatusPageNotFound
	}
	if err != nil {
		return StatusPageScope{}, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT m.id, CASE WHEN m.enabled THEN m.status ELSE 'paused' END
		FROM status_page_monitors l JOIN monitors m ON m.id = l.monitor_id WHERE l.page_id = $1`, pageID)
	if err != nil {
		return StatusPageScope{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var status string
		if err := rows.Scan(&id, &status); err != nil {
			return StatusPageScope{}, err
		}
		scope.Monitors[id] = status
	}
	return scope, rows.Err()
}

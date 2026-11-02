package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

var (
	ErrAPIKeyNotFound = errors.New("api key not found")
	ErrAPIKeyLimit    = fmt.Errorf("a workspace can have at most %d active API keys", MaxAPIKeysPerWorkspace)
)

// MaxAPIKeysPerWorkspace caps active (unrevoked) keys per workspace.
const MaxAPIKeysPerWorkspace = 20

// API key scopes. read covers GET requests, write covers changes to monitors
// and alert rules, and probe allows running diagnostics such as ping and
// port scans.
const (
	ScopeRead  = "read"
	ScopeWrite = "write"
	ScopeProbe = "probe"
)

var APIKeyScopes = []string{ScopeRead, ScopeWrite, ScopeProbe}

type APIKey struct {
	ID          int64      `json:"id"`
	WorkspaceID int64      `json:"-"`
	CreatedBy   int64      `json:"created_by,omitempty"`
	CreatorName string     `json:"creator_name,omitempty"`
	Name        string     `json:"name"`
	Prefix      string     `json:"prefix"`
	Scopes      []string   `json:"scopes"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
	LastUsedAt  *time.Time `json:"last_used_at,omitempty"`
	LastUsedIP  string     `json:"last_used_ip,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// HasScope reports whether the key grants scope.
func (k APIKey) HasScope(scope string) bool {
	return slices.Contains(k.Scopes, scope)
}

// CreateAPIKey stores a new key. tokenHash is the SHA-256 of the token, which
// the caller generates and shows to the user once.
func (s *Store) CreateAPIKey(ctx context.Context, k APIKey, tokenHash string) (APIKey, error) {
	if s == nil {
		return APIKey{}, errors.New("store is not available")
	}
	if err := validateAPIKey(&k); err != nil {
		return APIKey{}, err
	}
	if tokenHash == "" || k.Prefix == "" {
		return APIKey{}, errors.New("token is required")
	}
	tx, err := s.beginWorkspaceTx(ctx, k.WorkspaceID)
	if err != nil {
		return APIKey{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM api_keys WHERE workspace_id = $1 AND revoked_at IS NULL`, k.WorkspaceID).Scan(&active); err != nil {
		return APIKey{}, err
	}
	if active >= MaxAPIKeysPerWorkspace {
		return APIKey{}, ErrAPIKeyLimit
	}

	var saved APIKey
	err = scanAPIKey(tx.QueryRowContext(ctx, `
		INSERT INTO api_keys (workspace_id, created_by, name, prefix, token_hash, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+apiKeyColumns+`, ''`,
		k.WorkspaceID, nullableID(k.CreatedBy), k.Name, k.Prefix, tokenHash, k.Scopes, k.ExpiresAt,
	), &saved)
	if err != nil {
		return APIKey{}, err
	}
	return saved, tx.Commit()
}

// ListAPIKeys returns the workspace's keys, revoked ones included, newest first.
func (s *Store) ListAPIKeys(ctx context.Context, workspaceID int64) ([]APIKey, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// users is outside the tenant role's grants, so the creator's name is
	// looked up separately below.
	rows, err := tx.QueryContext(ctx, `SELECT `+apiKeyColumns+`, '' FROM api_keys WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	keys := make([]APIKey, 0, 4)
	for rows.Next() {
		var k APIKey
		if err := scanAPIKey(rows, &k); err != nil {
			rows.Close()
			return nil, err
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return keys, s.fillCreatorNames(ctx, keys)
}

func (s *Store) fillCreatorNames(ctx context.Context, keys []APIKey) error {
	ids := make([]int64, 0, len(keys))
	for _, k := range keys {
		if k.CreatedBy > 0 && !slices.Contains(ids, k.CreatedBy) {
			ids = append(ids, k.CreatedBy)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, name FROM users WHERE id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	names := map[int64]string{}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return err
		}
		names[id] = name
	}
	for i := range keys {
		keys[i].CreatorName = names[keys[i].CreatedBy]
	}
	return rows.Err()
}

// RevokeAPIKey stops a key from working. Revoked keys stay listed.
func (s *Store) RevokeAPIKey(ctx context.Context, workspaceID, keyID int64) (APIKey, error) {
	if s == nil {
		return APIKey{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return APIKey{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var k APIKey
	err = scanAPIKey(tx.QueryRowContext(ctx, `
		UPDATE api_keys SET revoked_at = COALESCE(revoked_at, NOW())
		WHERE id = $1 AND workspace_id = $2
		RETURNING `+apiKeyColumns+`, ''`, keyID, workspaceID), &k)
	if errors.Is(err, sql.ErrNoRows) {
		return APIKey{}, ErrAPIKeyNotFound
	}
	if err != nil {
		return APIKey{}, err
	}
	return k, tx.Commit()
}

// AuthenticateAPIKey finds the active key with this token hash and records
// its use at most once a minute. It runs as the login role because the
// workspace isn't known until the key is found.
func (s *Store) AuthenticateAPIKey(ctx context.Context, tokenHash, ip string) (APIKey, error) {
	if s == nil {
		return APIKey{}, errors.New("store is not available")
	}
	var k APIKey
	err := scanAPIKey(s.db.QueryRowContext(ctx, `
		SELECT `+apiKeyColumns+`, '' FROM api_keys
		WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
	`, tokenHash), &k)
	if errors.Is(err, sql.ErrNoRows) {
		return APIKey{}, ErrAPIKeyNotFound
	}
	if err != nil {
		return APIKey{}, err
	}
	if k.LastUsedAt == nil || time.Since(*k.LastUsedAt) > time.Minute || k.LastUsedIP != ip {
		_, _ = s.db.ExecContext(ctx, `UPDATE api_keys SET last_used_at = NOW(), last_used_ip = $2 WHERE id = $1`, k.ID, truncate(ip, 64))
	}
	return k, nil
}

func validateAPIKey(k *APIKey) error {
	if k.WorkspaceID <= 0 {
		return errors.New("workspace is required")
	}
	k.Name = strings.TrimSpace(k.Name)
	if k.Name == "" {
		return errors.New("name is required")
	}
	if len(k.Name) > 80 {
		return errors.New("name must be 80 characters or fewer")
	}
	if len(k.Scopes) == 0 {
		return errors.New("choose at least one scope")
	}
	seen := make([]string, 0, len(k.Scopes))
	for _, scope := range k.Scopes {
		scope = strings.ToLower(strings.TrimSpace(scope))
		if !slices.Contains(APIKeyScopes, scope) {
			return fmt.Errorf("unknown scope %q", scope)
		}
		if !slices.Contains(seen, scope) {
			seen = append(seen, scope)
		}
	}
	// Keep a stable order so lists and audit entries read the same way.
	slices.SortFunc(seen, func(a, b string) int { return slices.Index(APIKeyScopes, a) - slices.Index(APIKeyScopes, b) })
	k.Scopes = seen
	if k.ExpiresAt != nil && !k.ExpiresAt.After(time.Now()) {
		return errors.New("expiry must be in the future")
	}
	return nil
}

const apiKeyColumns = `id, workspace_id, COALESCE(created_by, 0), name, prefix, scopes, expires_at, revoked_at, last_used_at, last_used_ip, created_at`

type apiKeyScanner interface {
	Scan(dest ...any) error
}

func scanAPIKey(scanner apiKeyScanner, k *APIKey) error {
	var scopes string
	var expires, revoked, lastUsed sql.NullTime
	if err := scanner.Scan(&k.ID, &k.WorkspaceID, &k.CreatedBy, &k.Name, &k.Prefix, &scopes,
		&expires, &revoked, &lastUsed, &k.LastUsedIP, &k.CreatedAt, &k.CreatorName); err != nil {
		return err
	}
	k.Scopes = parseScopeArray(scopes)
	k.ExpiresAt = nullTimePtr(expires)
	k.RevokedAt = nullTimePtr(revoked)
	k.LastUsedAt = nullTimePtr(lastUsed)
	return nil
}

// parseScopeArray reads a text[] that database/sql hands over as "{a,b}".
// Scopes are plain lowercase words, so no quoting can occur.
func parseScopeArray(value string) []string {
	value = strings.Trim(value, "{}")
	if value == "" {
		return []string{}
	}
	return strings.Split(value, ",")
}

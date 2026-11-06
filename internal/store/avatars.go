package store

import (
	"context"
	"database/sql"
	"errors"
)

// ErrAvatarNotFound means the user has no avatar image in the database.
var ErrAvatarNotFound = errors.New("avatar not found")

// SaveUserAvatarData stores or replaces the user's avatar image.
func (s *Store) SaveUserAvatarData(ctx context.Context, userID int64, contentType string, data []byte) error {
	if s == nil {
		return errors.New("store is not available")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO user_avatars (user_id, content_type, data, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = NOW()
	`, userID, contentType, data)
	return err
}

// GetUserAvatarData returns the user's avatar image and its type.
func (s *Store) GetUserAvatarData(ctx context.Context, userID int64) (string, []byte, error) {
	if s == nil {
		return "", nil, errors.New("store is not available")
	}
	var contentType string
	var data []byte
	err := s.db.QueryRowContext(ctx, `SELECT content_type, data FROM user_avatars WHERE user_id = $1`, userID).Scan(&contentType, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, ErrAvatarNotFound
	}
	return contentType, data, err
}

// DeleteUserAvatarData removes the user's avatar image, if any.
func (s *Store) DeleteUserAvatarData(ctx context.Context, userID int64) error {
	if s == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM user_avatars WHERE user_id = $1`, userID)
	return err
}

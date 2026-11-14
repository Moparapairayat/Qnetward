package store

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestCreateUserAndSessionFlow(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("auth_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Auth Tester", email, "hashed-password", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	if user.Email != email {
		t.Fatalf("expected email %q, got %q", email, user.Email)
	}

	tokenHash := fmt.Sprintf("token-%d", time.Now().UnixNano())
	if err := st.CreateSession(ctx, user.ID, tokenHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	sessionUser, err := st.GetUserBySessionToken(ctx, tokenHash)
	if err != nil {
		t.Fatalf("GetUserBySessionToken returned error: %v", err)
	}
	if sessionUser.ID != user.ID {
		t.Fatalf("expected session user id %d, got %d", user.ID, sessionUser.ID)
	}
}

func TestCreateUserRejectsDuplicateEmail(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("dupe_%d@example.com", time.Now().UnixNano())
	if _, err := st.CreateUser(ctx, "First User", email, "hash-1", false); err != nil {
		t.Fatalf("first CreateUser returned error: %v", err)
	}
	if _, err := st.CreateUser(ctx, "Second User", email, "hash-2", false); !errors.Is(err, ErrUserExists) {
		t.Fatalf("expected ErrUserExists, got %v", err)
	}
}

func TestUpdateUserProfileNameOnly(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("profile_name_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Original Operator", email, "hash-1", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}

	updated, emailChanged, err := st.UpdateUserProfile(ctx, user.ID, "Updated Operator", email)
	if err != nil {
		t.Fatalf("UpdateUserProfile returned error: %v", err)
	}
	if emailChanged {
		t.Fatal("expected name-only update to keep email unchanged")
	}
	if updated.Name != "Updated Operator" {
		t.Fatalf("expected updated name, got %q", updated.Name)
	}
	if updated.Email != email {
		t.Fatalf("expected unchanged email %q, got %q", email, updated.Email)
	}
	if updated.VerificationRequired {
		t.Fatal("expected verification state to remain unchanged")
	}
}

func TestUpdateUserProfileEmailChangeResetsVerification(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("profile_email_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Profile Operator", email, "hash-1", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	if err := st.CreateEmailVerificationCode(ctx, user.ID, "stale-code", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateEmailVerificationCode returned error: %v", err)
	}

	nextEmail := fmt.Sprintf("profile_email_updated_%d@example.com", time.Now().UnixNano())
	updated, emailChanged, err := st.UpdateUserProfile(ctx, user.ID, "Profile Operator", nextEmail)
	if err != nil {
		t.Fatalf("UpdateUserProfile returned error: %v", err)
	}
	if !emailChanged {
		t.Fatal("expected email change to be reported")
	}
	if updated.Email != nextEmail {
		t.Fatalf("expected updated email %q, got %q", nextEmail, updated.Email)
	}
	if !updated.VerificationRequired {
		t.Fatal("expected verification to be required after email change")
	}
	if updated.EmailVerifiedAt != nil {
		t.Fatal("expected email verification timestamp to be cleared")
	}

	var codeCount int
	if err := st.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM email_verification_codes
		WHERE user_id = $1
	`, user.ID).Scan(&codeCount); err != nil {
		t.Fatalf("count verification codes: %v", err)
	}
	if codeCount != 0 {
		t.Fatalf("expected stale verification codes to be deleted, got %d", codeCount)
	}
}

func TestUpdateUserProfileRejectsDuplicateEmail(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	firstEmail := fmt.Sprintf("profile_dupe_first_%d@example.com", time.Now().UnixNano())
	secondEmail := fmt.Sprintf("profile_dupe_second_%d@example.com", time.Now().UnixNano())
	first, err := st.CreateUser(ctx, "First Operator", firstEmail, "hash-1", false)
	if err != nil {
		t.Fatalf("CreateUser first returned error: %v", err)
	}
	if _, err := st.CreateUser(ctx, "Second Operator", secondEmail, "hash-2", false); err != nil {
		t.Fatalf("CreateUser second returned error: %v", err)
	}

	if _, _, err := st.UpdateUserProfile(ctx, first.ID, "First Operator", secondEmail); !errors.Is(err, ErrUserExists) {
		t.Fatalf("expected ErrUserExists, got %v", err)
	}
}

func TestPasswordResetTokenFlow(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("reset_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Reset Tester", email, "hash-1", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}

	tokenHash := fmt.Sprintf("reset-token-%d", time.Now().UnixNano())
	if err := st.CreatePasswordResetToken(ctx, user.ID, tokenHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreatePasswordResetToken returned error: %v", err)
	}

	if err := st.ResetPasswordWithToken(ctx, tokenHash, "hash-2"); err != nil {
		t.Fatalf("ResetPasswordWithToken returned error: %v", err)
	}

	_, passwordHash, err := st.AuthenticateUser(ctx, email)
	if err != nil {
		t.Fatalf("AuthenticateUser returned error: %v", err)
	}
	if passwordHash != "hash-2" {
		t.Fatalf("expected updated password hash, got %q", passwordHash)
	}

	if err := st.ResetPasswordWithToken(ctx, tokenHash, "hash-3"); !errors.Is(err, ErrResetTokenNotFound) {
		t.Fatalf("expected ErrResetTokenNotFound on reused token, got %v", err)
	}
}

func TestEmailVerificationCodeFlow(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("verify_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Verify Tester", email, "hash-1", true)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}

	codeHash := fmt.Sprintf("verify-code-%d", time.Now().UnixNano())
	if err := st.CreateEmailVerificationCode(ctx, user.ID, codeHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateEmailVerificationCode returned error: %v", err)
	}

	verifiedUser, err := st.VerifyUserEmailCode(ctx, email, codeHash)
	if err != nil {
		t.Fatalf("VerifyUserEmailCode returned error: %v", err)
	}
	if verifiedUser.VerificationRequired {
		t.Fatal("expected user to be marked verified")
	}
	if verifiedUser.EmailVerifiedAt == nil {
		t.Fatal("expected verification timestamp")
	}

	if _, err := st.VerifyUserEmailCode(ctx, email, codeHash); !errors.Is(err, ErrVerificationCode) {
		t.Fatalf("expected ErrVerificationCode on reused code, got %v", err)
	}
}

func TestCreatePasswordResetTokenKeepsSingleActiveRowPerUser(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("reset_single_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Reset Single User", email, "hash-1", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			tokenHash := fmt.Sprintf("reset-token-%d-%d", user.ID, i)
			if err := st.CreatePasswordResetToken(ctx, user.ID, tokenHash, time.Now().Add(time.Hour)); err != nil {
				errCh <- err
			}
		}(i)
	}
	wg.Wait()
	close(errCh)

	for err := range errCh {
		t.Fatalf("CreatePasswordResetToken returned error: %v", err)
	}

	var count int
	if err := st.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM password_reset_tokens
		WHERE user_id = $1
	`, user.ID).Scan(&count); err != nil {
		t.Fatalf("count password reset tokens: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 password reset row, got %d", count)
	}
}

func TestCreateEmailVerificationCodeKeepsSingleActiveRowPerUser(t *testing.T) {
	st := openTestStore(t, Config{
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("verify_single_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Verify Single User", email, "hash-1", true)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codeHash := fmt.Sprintf("verify-code-%d", i)
			if err := st.CreateEmailVerificationCode(ctx, user.ID, codeHash, time.Now().Add(time.Hour)); err != nil {
				errCh <- err
			}
		}(i)
	}
	wg.Wait()
	close(errCh)

	for err := range errCh {
		t.Fatalf("CreateEmailVerificationCode returned error: %v", err)
	}

	var count int
	if err := st.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM email_verification_codes
		WHERE user_id = $1
	`, user.ID).Scan(&count); err != nil {
		t.Fatalf("count verification codes: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 email verification row, got %d", count)
	}
}

// Wrong guesses spend a verification code: after MaxEmailCodeAttempts, even the
// right code is refused until a new one is sent, which starts the count again.
func TestEmailVerificationCodeAttempts(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("guess_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Guess Tester", email, "hash-1", true)
	if err != nil {
		t.Fatal(err)
	}
	right := fmt.Sprintf("right-%d", time.Now().UnixNano())
	if err := st.CreateEmailVerificationCode(ctx, user.ID, right, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxEmailCodeAttempts; i++ {
		if _, err := st.VerifyUserEmailCode(ctx, email, fmt.Sprintf("wrong-%d", i)); !errors.Is(err, ErrVerificationCode) {
			t.Fatalf("wrong guess %d: expected ErrVerificationCode, got %v", i+1, err)
		}
	}
	if _, err := st.VerifyUserEmailCode(ctx, email, right); !errors.Is(err, ErrVerificationCode) {
		t.Fatalf("after %d wrong guesses the code should be spent, got %v", MaxEmailCodeAttempts, err)
	}

	// A new code works, and its count starts from zero.
	fresh := fmt.Sprintf("fresh-%d", time.Now().UnixNano())
	if err := st.CreateEmailVerificationCode(ctx, user.ID, fresh, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.VerifyUserEmailCode(ctx, email, "wrong-again"); !errors.Is(err, ErrVerificationCode) {
		t.Fatalf("expected ErrVerificationCode, got %v", err)
	}
	if _, err := st.VerifyUserEmailCode(ctx, email, fresh); err != nil {
		t.Fatalf("a new code should verify after one wrong guess: %v", err)
	}
}

package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var ErrPaymentNotFound = errors.New("payment not found")

// Payment is one checkout for a paid plan.
type Payment struct {
	ID            int64      `json:"id"`
	WorkspaceID   int64      `json:"-"`
	UserID        int64      `json:"-"`
	Provider      string     `json:"provider"`
	Plan          string     `json:"plan"`
	Months        int        `json:"months"`
	Amount        float64    `json:"amount"`
	Currency      string     `json:"currency"`
	Status        string     `json:"status"`
	InvoiceID     string     `json:"invoice_id,omitempty"`
	TransactionID string     `json:"transaction_id,omitempty"`
	PaymentMethod string     `json:"payment_method,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
}

const paymentColumns = `id, workspace_id, COALESCE(user_id, 0), provider, plan, months, amount::float8, currency, status,
	COALESCE(invoice_id, ''), transaction_id, payment_method, created_at, paid_at`

func scanPayment(scanner interface{ Scan(...any) error }, p *Payment) error {
	var paid sql.NullTime
	if err := scanner.Scan(&p.ID, &p.WorkspaceID, &p.UserID, &p.Provider, &p.Plan, &p.Months, &p.Amount, &p.Currency, &p.Status,
		&p.InvoiceID, &p.TransactionID, &p.PaymentMethod, &p.CreatedAt, &paid); err != nil {
		return err
	}
	if paid.Valid {
		t := paid.Time
		p.PaidAt = &t
	}
	return nil
}

// CreatePayment records a checkout before the customer is sent to pay.
func (s *Store) CreatePayment(ctx context.Context, p Payment) (Payment, error) {
	if s == nil {
		return Payment{}, errors.New("store is not available")
	}
	var saved Payment
	err := scanPayment(s.db.QueryRowContext(ctx, `
		INSERT INTO payments (workspace_id, user_id, provider, plan, months, amount, currency)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+paymentColumns,
		p.WorkspaceID, nullableID(p.UserID), p.Provider, p.Plan, p.Months, p.Amount, p.Currency,
	), &saved)
	return saved, err
}

// GetPayment returns one payment.
func (s *Store) GetPayment(ctx context.Context, id int64) (Payment, error) {
	if s == nil {
		return Payment{}, errors.New("store is not available")
	}
	var p Payment
	err := scanPayment(s.db.QueryRowContext(ctx, `SELECT `+paymentColumns+` FROM payments WHERE id = $1`, id), &p)
	if errors.Is(err, sql.ErrNoRows) {
		return Payment{}, ErrPaymentNotFound
	}
	return p, err
}

// CompletePayment marks a pending payment paid and moves the workspace onto
// its plan for the months bought, after any time already paid for. It does
// this once: completing a payment again changes nothing and reports false.
// A payment marked failed can still complete: the gateway's word that it was
// paid in full wins, so money taken is never left without its plan.
func (s *Store) CompletePayment(ctx context.Context, id int64, invoiceID, transactionID, method string) (Payment, bool, error) {
	if s == nil {
		return Payment{}, false, errors.New("store is not available")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Payment{}, false, err
	}
	defer func() { _ = tx.Rollback() }()

	var p Payment
	err = scanPayment(tx.QueryRowContext(ctx, `
		UPDATE payments SET status = 'paid', invoice_id = $2, transaction_id = $3, payment_method = $4, paid_at = NOW()
		WHERE id = $1 AND status IN ('pending', 'failed')
		RETURNING `+paymentColumns, id, invoiceID, transactionID, method), &p)
	if errors.Is(err, sql.ErrNoRows) {
		existing, getErr := s.GetPayment(ctx, id)
		if getErr != nil {
			return Payment{}, false, getErr
		}
		return existing, false, nil
	}
	if err != nil {
		return Payment{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE workspaces SET
			plan = $2,
			billing_status = 'active',
			plan_expires_at = GREATEST(COALESCE(plan_expires_at, NOW()), NOW()) + make_interval(months => $3)
		WHERE id = $1
	`, p.WorkspaceID, p.Plan, p.Months); err != nil {
		return Payment{}, false, err
	}
	return p, true, tx.Commit()
}

// FailPayment marks a pending payment failed, so it leaves the "waiting" list.
func (s *Store) FailPayment(ctx context.Context, id int64) error {
	if s == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `UPDATE payments SET status = 'failed' WHERE id = $1 AND status = 'pending'`, id)
	return err
}

// ListPayments returns the workspace's recent paid and pending payments.
func (s *Store) ListPayments(ctx context.Context, workspaceID int64) ([]Payment, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+paymentColumns+` FROM payments
		WHERE workspace_id = $1 AND (status = 'paid' OR created_at > NOW() - INTERVAL '1 day')
		ORDER BY created_at DESC LIMIT 24`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Payment{}
	for rows.Next() {
		var p Payment
		if err := scanPayment(rows, &p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// WorkspacePlanExpiry returns when the workspace's paid period ends, or nil
// for Free and for plans set by hand.
func (s *Store) WorkspacePlanExpiry(ctx context.Context, workspaceID int64) (*time.Time, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	var at sql.NullTime
	if err := s.db.QueryRowContext(ctx, `SELECT plan_expires_at FROM workspaces WHERE id = $1`, workspaceID).Scan(&at); err != nil {
		return nil, err
	}
	if !at.Valid {
		return nil, nil
	}
	t := at.Time
	return &t, nil
}

// ExpirePlans moves workspaces whose paid period has ended back to Free.
func (s *Store) ExpirePlans(ctx context.Context) (int64, error) {
	if s == nil {
		return 0, nil
	}
	res, err := s.db.ExecContext(ctx, `UPDATE workspaces SET plan = 'free', billing_status = 'canceled', plan_expires_at = NULL
		WHERE plan_expires_at IS NOT NULL AND plan_expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// SetPaymentInvoice records the gateway's invoice for a checkout as soon as it
// exists, so the payment can be checked later even if the browser never
// comes back from the gateway.
func (s *Store) SetPaymentInvoice(ctx context.Context, id int64, invoiceID string) error {
	if s == nil {
		return errors.New("store is not available")
	}
	_, err := s.db.ExecContext(ctx, `UPDATE payments SET invoice_id = $2 WHERE id = $1 AND invoice_id IS NULL`, id, invoiceID)
	return err
}

// PaymentsToReconcile lists pending payments with a known invoice, started
// after since, oldest first: the ones whose outcome is still to be learned
// from the gateway.
func (s *Store) PaymentsToReconcile(ctx context.Context, since time.Time, limit int) ([]Payment, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+paymentColumns+` FROM payments
		WHERE status = 'pending' AND invoice_id IS NOT NULL AND created_at > $1
		ORDER BY created_at
		LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Payment
	for rows.Next() {
		var p Payment
		if err := scanPayment(rows, &p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ExpireStalePayments marks checkouts started before the cutoff and never paid
// as failed, so they leave the receipts list. A gateway that later confirms
// one as paid still completes it (see CompletePayment).
func (s *Store) ExpireStalePayments(ctx context.Context, before time.Time) (int64, error) {
	if s == nil {
		return 0, errors.New("store is not available")
	}
	res, err := s.db.ExecContext(ctx, `UPDATE payments SET status = 'failed' WHERE status = 'pending' AND created_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

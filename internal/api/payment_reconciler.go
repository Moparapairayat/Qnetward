package api

import (
	"context"
	"log"
	"time"
)

const (
	// paymentReconcileEvery is how often pending payments are checked with the gateway.
	paymentReconcileEvery = 2 * time.Minute
	// paymentReconcileWindow is how long after checkout a payment keeps being checked.
	paymentReconcileWindow = 48 * time.Hour
	paymentReconcileBatch  = 50
)

// RunPaymentReconciler settles payments the browser never came back from.
// UddoktaPay sends its webhook only when an admin presses a button, so a
// customer who pays and then closes the tab would otherwise be charged
// without getting the plan. Every few minutes this asks the gateway about each
// recent pending payment and applies the ones that were paid. It is safe on
// several instances at once: completing a payment twice changes nothing.
func (srv *Server) RunPaymentReconciler(ctx context.Context) {
	if srv.store == nil {
		return
	}
	ticker := time.NewTicker(paymentReconcileEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			srv.reconcilePayments(ctx)
		}
	}
}

// reconcilePayments checks one batch of pending payments with the gateway.
func (srv *Server) reconcilePayments(ctx context.Context) {
	if !srv.payments.Configured() {
		return
	}
	listCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	pending, err := srv.store.PaymentsToReconcile(listCtx, time.Now().Add(-paymentReconcileWindow), paymentReconcileBatch)
	cancel()
	if err != nil {
		log.Printf("listing payments to reconcile failed: %v", err)
		return
	}
	// Checkouts nobody paid within the window stop being checked and leave the list.
	expireCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	if _, err := srv.store.ExpireStalePayments(expireCtx, time.Now().Add(-paymentReconcileWindow)); err != nil {
		log.Printf("expiring unpaid checkouts failed: %v", err)
	}
	cancel()
	for _, p := range pending {
		if ctx.Err() != nil {
			return
		}
		settleCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		outcome, _ := srv.settlePayment(settleCtx, nil, p.InvoiceID)
		cancel()
		if outcome == "success" {
			log.Printf("payment %d was paid without coming back from the gateway; plan applied", p.ID)
		}
	}
}

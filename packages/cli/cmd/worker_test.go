package cmd

import (
	"strings"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

func TestNormalizeSummaryPeriodFlag(t *testing.T) {
	cases := []struct {
		input string
		want  string
		err   bool
	}{
		{"", "daily", false},
		{"daily", "daily", false},
		{"DAILY", "daily", false},
		{"  weekly  ", "weekly", false},
		{"Weekly", "weekly", false},
		{"hourly", "", true},
		{"monthly", "", true},
	}

	for _, tc := range cases {
		got, err := normalizeSummaryPeriodFlag(tc.input)
		if tc.err {
			if err == nil {
				t.Fatalf("normalizeSummaryPeriodFlag(%q) expected error, got %q", tc.input, got)
			}
			continue
		}
		if err != nil {
			t.Fatalf("normalizeSummaryPeriodFlag(%q) unexpected error: %v", tc.input, err)
		}
		if got != tc.want {
			t.Fatalf("normalizeSummaryPeriodFlag(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestSummaryDeliverySummary(t *testing.T) {
	cases := []struct {
		name string
		in   *client.SummaryDelivery
		want string
	}{
		{"nil", nil, "-"},
		{"message id", &client.SummaryDelivery{MessageID: "msg-1"}, "message:msg-1"},
		{"accounts sent", &client.SummaryDelivery{
			AccountsSelected: 3, AccountsAttempted: 3, AccountsSent: 2, TotalBatches: 1,
		}, "2/3 sent, 1 batches"},
		{"accounts override", &client.SummaryDelivery{
			AccountsSelected: 2, AccountsSent: 2, UsedOverrideBotToken: true,
		}, "2/2 sent, override"},
		{"channel only", &client.SummaryDelivery{Channel: "telegram"}, "telegram"},
		{"ok flag", &client.SummaryDelivery{OK: true}, "ok"},
		{"empty delivery", &client.SummaryDelivery{}, "available"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := summaryDeliverySummary(tc.in)
			if got != tc.want {
				t.Fatalf("summaryDeliverySummary(%s) = %q, want %q", tc.name, got, tc.want)
			}
		})
	}
}

func TestSummaryDeliveryAccounts(t *testing.T) {
	t.Run("nil delivery", func(t *testing.T) {
		if got := summaryDeliveryAccounts(nil); got != "-" {
			t.Fatalf("summaryDeliveryAccounts(nil) = %q, want -", got)
		}
	})
	t.Run("empty accounts", func(t *testing.T) {
		if got := summaryDeliveryAccounts(&client.SummaryDelivery{}); got != "-" {
			t.Fatalf("summaryDeliveryAccounts(empty) = %q, want -", got)
		}
	})
	t.Run("mixed statuses", func(t *testing.T) {
		delivery := &client.SummaryDelivery{
			Accounts: []client.SummaryDeliveryAccount{
				{Index: 0, ChatIDHint: "abc", Sent: true, BatchesPlanned: 2},
				{Index: 1, ChatIDHint: "def", Attempted: true},
				{Index: 2, ChatIDHint: "ghi"},
			},
		}
		got := summaryDeliveryAccounts(delivery)
		if !strings.Contains(got, "0:abc:sent(2b)") {
			t.Fatalf("missing sent entry: %s", got)
		}
		if !strings.Contains(got, "1:def:failed") {
			t.Fatalf("missing failed entry: %s", got)
		}
		if !strings.Contains(got, "2:ghi:skipped") {
			t.Fatalf("missing skipped entry: %s", got)
		}
	})
}

func TestEmptyDash(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "-"},
		{"   ", "-"},
		{"\t\n", "-"},
		{"value", "value"},
		{" error msg ", " error msg "},
	}
	for _, tc := range cases {
		if got := emptyDash(tc.in); got != tc.want {
			t.Fatalf("emptyDash(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestFormatWorkerSchedule(t *testing.T) {
	cases := []struct {
		name string
		in   *client.WorkerStatus
		want string
	}{
		{"nil status", nil, "-"},
		{"empty schedule value", &client.WorkerStatus{}, "-"},
		{"whitespace schedule value", &client.WorkerStatus{ScheduleValue: "  "}, "-"},
		{"cron type", &client.WorkerStatus{ScheduleType: "cron", ScheduleValue: "0 9 * * *"}, "Cron: 0 9 * * *"},
		{"interval type", &client.WorkerStatus{ScheduleType: "interval", ScheduleValue: "300s"}, "Every 300s"},
		{"unknown type", &client.WorkerStatus{ScheduleType: "custom", ScheduleValue: "manual"}, "manual"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := formatWorkerSchedule(tc.in); got != tc.want {
				t.Fatalf("formatWorkerSchedule(%s) = %q, want %q", tc.name, got, tc.want)
			}
		})
	}
}

func TestWorkerCommandTree(t *testing.T) {
	root := newWorkerCmd()
	subs := root.Commands()
	if len(subs) != 3 {
		t.Fatalf("expected 3 worker subcommands, got %d", len(subs))
	}

	summaryCmd := newWorkerSummaryCmd()
	summarySubs := summaryCmd.Commands()
	if len(summarySubs) != 3 {
		t.Fatalf("expected 3 summary subcommands, got %d", len(summarySubs))
	}

	var _ *cobra.Command = newWorkerRunCmd()
}

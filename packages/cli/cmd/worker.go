package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

func newWorkerCmd() *cobra.Command {
	workerCmd := &cobra.Command{
		Use:   "worker",
		Short: "Worker operations",
	}

	workerCmd.AddCommand(
		newWorkerStatusCmd(),
		newWorkerRunCmd(),
	)

	return workerCmd
}

func newWorkerStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Get worker status",
		RunE: func(cmd *cobra.Command, args []string) error {
			status, err := newAPIClient().WorkerStatus(context.Background())
			if err != nil {
				return err
			}

			headers := []string{"running", "jobs_executed", "jobs_failed", "jobs_missed", "last_run", "last_success", "last_failure"}
			rows := [][]string{{
				boolToString(status.Running),
				fmt.Sprintf("%d", status.JobsExecuted),
				fmt.Sprintf("%d", status.JobsFailed),
				fmt.Sprintf("%d", status.JobsMissed),
				status.LastRun,
				status.LastSuccess,
				status.LastFailure,
			}}
			return writeOutput(cmd, headers, rows, status)
		},
	}
}

func newWorkerRunCmd() *cobra.Command {
	var once bool

	cmd := &cobra.Command{
		Use:   "run",
		Short: "Trigger worker run",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().RunWorker(context.Background(), once)
			if err != nil {
				return err
			}

			headers := []string{"mode", "started_at", "finished_at", "message"}
			rows := [][]string{{response.Mode, response.StartedAt, response.FinishedAt, response.Message}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().BoolVar(&once, "once", true, "Run once immediately")
	return cmd
}

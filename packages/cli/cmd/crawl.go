package cmd

import (
	"context"
	"strconv"

	"github.com/spf13/cobra"
)

func newCrawlCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "crawl",
		Short: "Trigger crawl via worker",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().TriggerCrawl(context.Background())
			if err != nil {
				return err
			}

			headers := []string{"mode", "started_at", "finished_at", "message"}
			rows := [][]string{{response.Mode, response.StartedAt, response.FinishedAt, response.Message}}
			return writeOutput(cmd, headers, rows, response)
		},
	}
}

func boolToString(value bool) string {
	return strconv.FormatBool(value)
}

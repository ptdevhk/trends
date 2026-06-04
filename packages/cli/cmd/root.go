package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

const (
	defaultAPIURL    = "http://localhost:3000"
	defaultWorkerURL = "http://localhost:8000"
	defaultOutput    = "agent"
)

type RootOptions struct {
	APIURL    string
	WorkerURL string
	Workspace string
	Output    string
}

var cliVersion = "dev"

var rootCmd = &cobra.Command{
	Use:           "trends",
	Short:         "Trends backend service CLI",
	SilenceUsage:  true,
	SilenceErrors: true,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		output := strings.ToLower(strings.TrimSpace(viper.GetString("output")))
		switch output {
		case "agent", "table", "json", "csv":
			viper.Set("output", output)
			return nil
		default:
			return fmt.Errorf("invalid output format %q (expected agent|table|json|csv)", output)
		}
	},
}

func init() {
	viper.SetDefault("api_url", defaultAPIURL)
	viper.SetDefault("worker_url", defaultWorkerURL)
	viper.SetDefault("workspace", "dev")
	viper.SetDefault("output", defaultOutput)

	viper.SetEnvPrefix("TRENDS")
	viper.AutomaticEnv()

	rootCmd.PersistentFlags().String("api-url", defaultAPIURL, "BFF API base URL")
	rootCmd.PersistentFlags().String("worker-url", defaultWorkerURL, "Worker API base URL")
	rootCmd.PersistentFlags().String("workspace", "dev", "Workspace slug")
	rootCmd.PersistentFlags().StringP("output", "o", defaultOutput, "Output format: agent|table|json|csv")

	_ = viper.BindPFlag("api_url", rootCmd.PersistentFlags().Lookup("api-url"))
	_ = viper.BindPFlag("worker_url", rootCmd.PersistentFlags().Lookup("worker-url"))
	_ = viper.BindPFlag("workspace", rootCmd.PersistentFlags().Lookup("workspace"))
	_ = viper.BindPFlag("output", rootCmd.PersistentFlags().Lookup("output"))

	rootCmd.AddCommand(
		newCrawlCmd(),
		newResumeCmd(),
		newJDCmd(),
		newSystemCmd(),
		newWorkerCmd(),
		newMigrateCmd(),
		newMCPCmd(),
	)
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func SetVersion(version string) {
	trimmed := strings.TrimSpace(version)
	if trimmed == "" {
		return
	}
	cliVersion = trimmed
	rootCmd.Version = trimmed
}

func currentVersion() string {
	if strings.TrimSpace(cliVersion) == "" {
		return "dev"
	}
	return cliVersion
}

func currentOptions() RootOptions {
	return RootOptions{
		APIURL:    normalizeBaseURL(viper.GetString("api_url")),
		WorkerURL: normalizeBaseURL(viper.GetString("worker_url")),
		Workspace: normalizeWorkspace(viper.GetString("workspace")),
		Output:    strings.ToLower(strings.TrimSpace(viper.GetString("output"))),
	}
}

var apiClientFactory = func() *client.Client {
	options := currentOptions()
	return client.New(options.APIURL, options.WorkerURL, options.Workspace)
}

func newAPIClient() *client.Client {
	return apiClientFactory()
}

func normalizeBaseURL(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	return strings.TrimRight(trimmed, "/")
}

func normalizeWorkspace(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "dev"
	}
	return trimmed
}

func findProjectRoot() (string, error) {
	current, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("read working directory: %w", err)
	}

	for {
		if looksLikeProjectRoot(current) {
			return current, nil
		}

		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}

	return "", fmt.Errorf("could not locate project root from %s", current)
}

func looksLikeProjectRoot(dir string) bool {
	required := []string{
		filepath.Join(dir, "CLAUDE.md"),
		filepath.Join(dir, "packages", "cli", "go.mod"),
		filepath.Join(dir, "scripts", "resume"),
	}
	for _, candidate := range required {
		if _, err := os.Stat(candidate); err != nil {
			return false
		}
	}
	return true
}

package cmd

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/spf13/viper"
)

func setResumeCLIConfig(t *testing.T, apiURL string, workspace string) {
	t.Helper()
	setResumeCLIConfigURLs(t, apiURL, apiURL, workspace)
}

func setResumeCLIConfigURLs(t *testing.T, apiURL string, workerURL string, workspace string) {
	t.Helper()

	originalAPIURL := viper.GetString("api_url")
	originalWorkerURL := viper.GetString("worker_url")
	originalWorkspace := viper.GetString("workspace")
	t.Cleanup(func() {
		viper.Set("api_url", originalAPIURL)
		viper.Set("worker_url", originalWorkerURL)
		viper.Set("workspace", originalWorkspace)
	})

	viper.Set("api_url", apiURL)
	viper.Set("worker_url", workerURL)
	viper.Set("workspace", workspace)
}

func setCLIOutput(t *testing.T, output string) {
	t.Helper()

	originalOutput := viper.GetString("output")
	t.Cleanup(func() {
		viper.Set("output", originalOutput)
	})
	viper.Set("output", output)
}

func decodeCommandJSON(t *testing.T, output bytes.Buffer) map[string]any {
	t.Helper()

	var payload map[string]any
	if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode command output: %v\noutput=%s", err, output.String())
	}
	return payload
}

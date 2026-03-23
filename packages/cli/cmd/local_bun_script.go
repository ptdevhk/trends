package cmd

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func buildBunScriptArgs(projectRoot string, scriptPath string, scriptArgs []string) ([]string, error) {
	args := make([]string, 0, len(scriptArgs)+3)

	envFilePath := filepath.Join(projectRoot, ".env")
	info, err := os.Stat(envFilePath)
	switch {
	case err == nil && !info.IsDir():
		args = append(args, "--env-file", envFilePath)
	case err == nil && info.IsDir():
		// Ignore directory-shaped .env entries and let the script use inherited env.
	case os.IsNotExist(err):
		// No repo-root .env file is fine; rely on inherited env instead.
	case err != nil:
		return nil, fmt.Errorf("stat env file: %w", err)
	}

	args = append(args, scriptPath)
	args = append(args, scriptArgs...)
	return args, nil
}

func runBunScript(ctx context.Context, projectRoot string, scriptPath string, scriptArgs []string, stdin []byte) (string, string, error) {
	args, err := buildBunScriptArgs(projectRoot, scriptPath, scriptArgs)
	if err != nil {
		return "", "", err
	}

	command := exec.CommandContext(ctx, "bun", args...)
	command.Dir = projectRoot
	if stdin != nil {
		command.Stdin = bytes.NewReader(stdin)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	err = command.Run()
	return stdout.String(), stderr.String(), err
}

func commandErrorOutput(stdout string, stderr string) string {
	if trimmed := strings.TrimSpace(stderr); trimmed != "" {
		return trimmed
	}
	if trimmed := strings.TrimSpace(stdout); trimmed != "" {
		return trimmed
	}
	return "no output"
}

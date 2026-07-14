package cmd

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/spf13/cobra"
)

const maxPublicErrorBytes = 2 << 10

func boundPublicErrorText(message string) string {
	message = strings.ToValidUTF8(message, string(utf8.RuneError))
	if len(message) <= maxPublicErrorBytes {
		return message
	}
	const suffix = "…"
	cut := maxPublicErrorBytes - len(suffix)
	for cut > 0 && !utf8.RuneStart(message[cut]) {
		cut--
	}
	return message[:cut] + suffix
}

func boundPublicError(err error) error {
	if err == nil {
		return nil
	}
	return errors.New(boundPublicErrorText(err.Error()))
}

func executeCobraCommand(cmd *cobra.Command) error {
	return boundPublicError(cmd.Execute())
}

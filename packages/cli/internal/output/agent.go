package output

import (
	"strconv"
	"strings"
)

type Field struct {
	Key   string
	Value string
}

type AgentFormatter struct{}

func (f *AgentFormatter) Format(data TabularData) ([]byte, error) {
	if len(data.Rows) == 0 {
		return nil, nil
	}

	columnCount := len(data.Headers)
	for _, row := range data.Rows {
		if len(row) > columnCount {
			columnCount = len(row)
		}
	}

	var builder strings.Builder
	for _, row := range data.Rows {
		fields := make([]Field, 0, columnCount)
		for index := 0; index < columnCount; index++ {
			key := "col_" + strconv.Itoa(index+1)
			if index < len(data.Headers) {
				key = data.Headers[index]
			}

			value := ""
			if index < len(row) {
				value = row[index]
			}
			fields = append(fields, Field{Key: key, Value: value})
		}
		builder.WriteString(FormatFields(fields))
		builder.WriteByte('\n')
	}

	return []byte(builder.String()), nil
}

func FormatFields(fields []Field) string {
	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		key := normalizeFieldKey(field.Key)
		if key == "" {
			continue
		}
		parts = append(parts, key+"="+formatFieldValue(field.Value))
	}
	return strings.Join(parts, " ")
}

func normalizeFieldKey(key string) string {
	trimmed := strings.ToLower(strings.TrimSpace(key))
	var builder strings.Builder
	lastSeparator := false

	for _, value := range trimmed {
		switch {
		case value >= 'a' && value <= 'z':
			builder.WriteRune(value)
			lastSeparator = false
		case value >= '0' && value <= '9':
			builder.WriteRune(value)
			lastSeparator = false
		case value == '_' || value == '-' || value == '.':
			builder.WriteRune(value)
			lastSeparator = false
		default:
			if !lastSeparator {
				builder.WriteByte('_')
				lastSeparator = true
			}
		}
	}

	return strings.Trim(builder.String(), "_")
}

func formatFieldValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "-"
	}
	if needsQuotedFieldValue(trimmed) {
		return strconv.Quote(trimmed)
	}
	return trimmed
}

func needsQuotedFieldValue(value string) bool {
	return strings.ContainsAny(value, " \t\n\r\"'=|")
}

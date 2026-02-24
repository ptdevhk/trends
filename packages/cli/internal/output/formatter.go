package output

import "fmt"

type TabularData struct {
	Headers []string
	Rows    [][]string
}

type Formatter interface {
	Format(data TabularData) ([]byte, error)
}

func NewFormatter(name string) (Formatter, error) {
	switch name {
	case "table":
		return &TableFormatter{}, nil
	case "json":
		return &JSONFormatter{}, nil
	case "csv":
		return &CSVFormatter{}, nil
	default:
		return nil, fmt.Errorf("unsupported output formatter %q", name)
	}
}

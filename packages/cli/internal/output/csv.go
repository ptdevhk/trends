package output

import (
	"bytes"
	"encoding/csv"
)

type CSVFormatter struct{}

func (f *CSVFormatter) Format(data TabularData) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if len(data.Headers) > 0 {
		if err := writer.Write(data.Headers); err != nil {
			return nil, err
		}
	}
	for _, row := range data.Rows {
		if err := writer.Write(row); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

package output

import "encoding/json"

type JSONFormatter struct{}

func (f *JSONFormatter) Format(data TabularData) ([]byte, error) {
	rows := make([]map[string]string, 0, len(data.Rows))
	for _, row := range data.Rows {
		record := make(map[string]string, len(data.Headers))
		for index, header := range data.Headers {
			if index < len(row) {
				record[header] = row[index]
				continue
			}
			record[header] = ""
		}
		rows = append(rows, record)
	}

	return json.MarshalIndent(rows, "", "  ")
}

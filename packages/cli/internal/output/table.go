package output

import (
	"bytes"

	"github.com/olekukonko/tablewriter"
)

type TableFormatter struct{}

func (f *TableFormatter) Format(data TabularData) ([]byte, error) {
	var buffer bytes.Buffer
	table := tablewriter.NewWriter(&buffer)
	table.SetAutoWrapText(false)
	table.SetHeader(data.Headers)
	table.AppendBulk(data.Rows)
	table.Render()
	return buffer.Bytes(), nil
}

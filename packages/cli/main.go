package main

import "github.com/ptdevhk/trends/packages/cli/cmd"

var version = "dev"

func main() {
	cmd.SetVersion(version)
	cmd.Execute()
}

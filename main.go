package main

import (
	"embed"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

func init() {
	// VS Code snap injects GTK paths pointing to snap-bundled modules built against
	// Ubuntu 20.04 glibc (core20). On Ubuntu 24.04 those modules fail to load libpthread.
	// Clear them so GTK falls back to system modules.
	if strings.HasPrefix(os.Getenv("GTK_EXE_PREFIX"), "/snap") {
		os.Unsetenv("GTK_EXE_PREFIX")
		os.Unsetenv("GTK_PATH")
		os.Unsetenv("GTK_IM_MODULE_FILE")
	}
}

//go:embed all:frontend/dist
var assets embed.FS

// version is injected at build time via -ldflags "-X main.version=v1.0.10"
var version = "v1.0.10"

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "TARDIS — Transfer And Retrieve Database In Seconds",
		Width:     1125,
		Height:    812,
		MinWidth:  875,
		MinHeight: 625,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 15, B: 20, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		Linux: &linux.Options{
			WindowIsTranslucent: false,
			WebviewGpuPolicy:    linux.WebviewGpuPolicyOnDemand,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

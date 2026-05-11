#!/bin/bash
# VS Code snap injects these env vars pointing to snap-bundled modules linked
# against Ubuntu 20.04 (core20). On Ubuntu 24.04 they cause WebKitNetworkProcess
# to crash via a glibc symbol mismatch (__libc_pthread_init).
unset GTK_EXE_PREFIX GTK_PATH GTK_IM_MODULE_FILE
unset GIO_MODULE_DIR GIO_LAUNCHED_DESKTOP_FILE GIO_LAUNCHED_DESKTOP_FILE_PID
unset XDG_DATA_HOME GSETTINGS_SCHEMA_DIR
export XDG_DATA_DIRS=/usr/share/ubuntu:/usr/share/gnome:/usr/local/share:/usr/share:/var/lib/snapd/desktop
export PATH=$PATH:$HOME/go/bin
exec wails dev -tags webkit2_41

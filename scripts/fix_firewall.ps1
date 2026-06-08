New-NetFirewallRule -DisplayName "Vite 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -RemoteAddress Any -ErrorAction SilentlyContinue

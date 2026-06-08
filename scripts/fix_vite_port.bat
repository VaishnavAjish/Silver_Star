@echo off
echo Adding firewall rule for Vite on port 5173...
netsh advfirewall firewall add rule name="Vite Dev 5173" dir=in action=allow protocol=TCP localport=5173
echo Done. Try http://192.168.1.211:5173 in browser now.
pause
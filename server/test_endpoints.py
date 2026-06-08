import urllib.request
import urllib.error
import json

endpoints = [
    '/api/inventory',
    '/api/inventory/lots',
    '/api/inventory/summary',
    '/api/dashboard',
    '/api/lot-process-issues',
    '/api/machines',
    '/api/items'
]

# Note: we need auth token, but we might get 401. If we get 500 without auth, we'll see.
# Let's just login first.
try:
    req = urllib.request.Request('http://localhost:5001/api/auth/login', 
        data=json.dumps({"email": "admin@silverstargrow.com", "password": "password"}).encode('utf-8'),
        headers={'Content-Type': 'application/json'})
    res = urllib.request.urlopen(req)
    data = json.loads(res.read())
    token = data.get('token')
    print("Login successful, testing endpoints...")
    
    for ep in endpoints:
        req = urllib.request.Request(f'http://localhost:5001{ep}', headers={'Authorization': f'Bearer {token}'})
        try:
            res = urllib.request.urlopen(req)
            print(f"{ep}: {res.status}")
        except urllib.error.HTTPError as e:
            print(f"{ep}: HTTP {e.code}")
            if e.code == 500:
                print("Body:", e.read().decode('utf-8'))
        except Exception as e:
            print(f"{ep}: Error {e}")
except Exception as e:
    print(f"Login failed: {e}")

import urllib.request
import json
import ssl

token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTAsInVzZXJuYW1lIjoiUm9oaXQiLCJyb2xlIjoiYWRtaW4iLCJmdWxsTmFtZSI6IlJvaGl0IEFnaGVyYSIsImlhdCI6MTc4MzY2MzIwMywiZXhwIjoxNzgzNjkyMDAzLCJpc3MiOiJzaWx2ZXJzdGFyLWdyb3ctYXV0aCJ9.LQiYUaUlnLYPsrPW3-b0rKUBY3I4s3gNhywhNfZSfwQ"

# Fetch accounts
accounts_url = "https://sflgd.in/api/accounts?is_group=false&status=active"
req_acc = urllib.request.Request(accounts_url)
req_acc.add_header('Authorization', f'Bearer {token}')
try:
    with urllib.request.urlopen(req_acc) as res:
        accounts = json.loads(res.read().decode('utf-8'))
        acc1 = accounts[0]['id']
        acc2 = accounts[1]['id']
        print(f"Using accounts: {acc1}, {acc2}")
except Exception as e:
    print("Error fetching accounts:", e)
    exit(1)

# Create JE
url = "https://sflgd.in/api/journal-entries"
payload = {
    "date": "2026-07-10",
    "description": "Test manual JE",
    "sourceType": "manual",
    "sourceId": None,
    "lines": [
        { "accountId": acc1, "debit": 100, "credit": 0, "narration": None, "costCenterId": None, "entityType": None, "entityId": None, "referenceNo": None },
        { "accountId": acc2, "debit": 0, "credit": 100, "narration": None, "costCenterId": None, "entityType": None, "entityId": None, "referenceNo": None }
    ],
    "autoPost": True
}

data = json.dumps(payload).encode('utf-8')

req = urllib.request.Request(url, data=data, method='POST')
req.add_header('Authorization', f'Bearer {token}')
req.add_header('Content-Type', 'application/json')
req.add_header('Content-Length', len(data))

try:
    with urllib.request.urlopen(req) as response:
        print("STATUS:", response.status)
        print("BODY:", response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print("STATUS:", e.code)
    print("BODY:", e.read().decode('utf-8'))
except Exception as e:
    print("ERROR:", e)

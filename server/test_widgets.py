import urllib.request
import urllib.error
import json

widgets = [
    'inventory_value', 'recent_movements', 'low_stock',
    'bank_balance', 'unpaid_invoices', 'pending_transfers',
    'recent_purchases', 'machine_status'
]

try:
    with open('token.txt', 'r') as f:
        token = f.read().strip()
        
    for w in widgets:
        ep = f"/api/dashboard/widget/{w}"
        req = urllib.request.Request(f'http://localhost:5001{ep}', headers={'Authorization': f'Bearer {token}'})
        try:
            res = urllib.request.urlopen(req)
            print(f"{ep}: {res.status}")
        except urllib.error.HTTPError as e:
            print(f"{ep}: HTTP {e.code}")
            if e.code >= 500:
                print("Body:", e.read().decode('utf-8'))
        except Exception as e:
            print(f"{ep}: Error {e}")
except Exception as e:
    print(f"Error: {e}")

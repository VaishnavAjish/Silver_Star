import psycopg2
import os

try:
    conn = psycopg2.connect(
        host="192.168.1.211",
        port=5433,
        dbname="silverstar_grow",
        user="postgres",
        password="Nidhi"
    )
    cur = conn.cursor()
    cur.execute("SELECT * FROM accounts LIMIT 5")
    rows = cur.fetchall()
    for row in rows:
        print(row)
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")

from flask import Flask, request, jsonify, render_template, redirect, url_for, session
import sqlite3
import os

# Load .env when available (optional)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# Optional: Authlib for Google OAuth
try:
    from authlib.integrations.flask_client import OAuth
except Exception:
    OAuth = None

app = Flask(__name__)

app.secret_key = os.environ.get('FLASK_SECRET', 'dev-secret-change-me')

# configure OAuth if available
oauth = None
if OAuth is not None:
    oauth = OAuth(app)
    google_client_id = os.environ.get('GOOGLE_CLIENT_ID')
    google_client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')
    if google_client_id and google_client_secret:
        oauth.register(
            name='google',
            client_id=google_client_id,
            client_secret=google_client_secret,
            server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
            client_kwargs={'scope': 'openid email profile'}
        )


# Require login for non-static, non-api UI routes
@app.before_request
def require_login():
    # allow static assets and API endpoints and OAuth/login routes
    path = request.path
    if path.startswith('/static/') or path.startswith('/api/'):
        return
    # allow auth and login routes
    if path.startswith('/login') or path.startswith('/auth') or path.startswith('/logout') or path == '/about':
        return
    # if no user in session, redirect to login
    if not session.get('user'):
        return redirect(url_for('login'))


def get_db():
    conn = sqlite3.connect("/data/mtg.db")
    conn.row_factory = sqlite3.Row
    return conn


def current_user_id():
    user = session.get('user')
    return user.get('id') if user else None


def init_db():
    conn = get_db()
    c = conn.cursor()

    # Opponents
    c.execute("""
        CREATE TABLE IF NOT EXISTS opponents (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            UNIQUE(name, user_id)
        )
    """)
    
    # Managed trackers (global list of allowed trackers)
    c.execute("""
        CREATE TABLE IF NOT EXISTS managed_trackers (
            id INTEGER PRIMARY KEY,
            tracker TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'player',
            user_id TEXT NOT NULL,
            UNIQUE(tracker, user_id)
        )
    """)

    # Decks (each belongs to one opponent)
    c.execute("""
        CREATE TABLE IF NOT EXISTS decks (
            id INTEGER PRIMARY KEY,
            opponent_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            FOREIGN KEY (opponent_id) REFERENCES opponents(id)
        )
    """)

    # Games (link to opponent + deck)
    c.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY,
            opponent_id INTEGER NOT NULL,
            deck_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (opponent_id) REFERENCES opponents(id),
            FOREIGN KEY (deck_id) REFERENCES decks(id)
        )
    """)

    # Trackers (per game)
    c.execute("""
        CREATE TABLE IF NOT EXISTS trackers (
            id INTEGER PRIMARY KEY,
            game_id INTEGER NOT NULL,
            tracker TEXT NOT NULL,
            count INTEGER DEFAULT 0,
            type TEXT NOT NULL DEFAULT 'player',
            player_seat INTEGER,
            FOREIGN KEY (game_id) REFERENCES games(id)
        )
    """)
    # Players (seats) in a game
    c.execute("""
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY,
            game_id INTEGER NOT NULL,
            seat INTEGER NOT NULL,
            opponent_id INTEGER NOT NULL,
            deck_id INTEGER NOT NULL,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (opponent_id) REFERENCES opponents(id),
            FOREIGN KEY (deck_id) REFERENCES decks(id)
        )
    """)

    # Trackers (per game)
    # (second trackers create is kept for compatibility; first above handles schema)


    conn.commit()
    conn.close()


@app.route("/")
def index():
    return render_template("index.html", user=session.get('user'))


@app.route("/stats")
def stats_page():
    return render_template("stats.html", user=session.get('user'))


@app.route("/manage-trackers")
def manage_trackers_page():
    return render_template("manage_trackers.html", user=session.get('user'))

@app.route('/about')
def about():
    return render_template('about.html')

# ---- Authentication routes (Google OAuth) ----
@app.route('/login')
def login():
    # Render a simple login screen with Google button
    return render_template('login.html')


@app.route('/login/google')
def login_google():
    if oauth is None:
        return "OAuth support not available (Authlib not installed).", 500

    # Ensure google client is registered (lazy registration in case .env was loaded later)
    clients = getattr(oauth, '_clients', None) or {}
    if 'google' not in clients:
        google_client_id = os.environ.get('GOOGLE_CLIENT_ID')
        google_client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')
        if not google_client_id or not google_client_secret:
            return "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", 500
        oauth.register(
            name='google',
            client_id=google_client_id,
            client_secret=google_client_secret,
            server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
            client_kwargs={'scope': 'openid email profile'}
        )

    redirect_uri = url_for('auth_callback', _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@app.route('/auth/callback')
def auth_callback():
    if oauth is None or 'google' not in (oauth._clients or {}):
        return "Google OAuth not configured.", 500
    token = oauth.google.authorize_access_token()
    if not token:
        return redirect(url_for('login'))
    userinfo = None
    try:
        # Try to parse the ID token (may require a stored 'nonce')
        userinfo = oauth.google.parse_id_token(token)
    except TypeError:
        # parse_id_token can raise TypeError when a 'nonce' argument is required
        # Fall back to the userinfo endpoint instead of failing the request
        pass

    if not userinfo:
        # Call Google's userinfo endpoint directly (full URL required)
        resp = oauth.google.get('https://openidconnect.googleapis.com/v1/userinfo')
        if not resp or resp.status_code != 200:
            return "Failed to fetch user info from provider.", 500
        userinfo = resp.json()
    # store user in session
    session['user'] = {
        'id': userinfo.get('sub'),
        'email': userinfo.get('email'),
        'name': userinfo.get('name'),
        'picture': userinfo.get('picture')
    }
    return redirect(url_for('index'))


@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('index'))


# -------- Opponents --------
@app.route("/api/opponents", methods=["GET", "POST"])
def opponents():
    conn = get_db()
    c = conn.cursor()
    uid = current_user_id()

    if request.method == "POST":
        data = request.json
        name = data.get("name", "").strip()
        if not name:
            conn.close()
            return jsonify({"error": "Name required"}), 400
        try:
            c.execute("INSERT INTO opponents (name, user_id) VALUES (?, ?)", (name, uid))
            conn.commit()
        except sqlite3.IntegrityError:
            # name already exists for this user
            pass

    rows = c.execute("SELECT id, name FROM opponents WHERE user_id=? ORDER BY name", (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# -------- Decks (per opponent) --------
@app.route("/api/opponents/<int:opponent_id>/decks", methods=["GET", "POST"])
def decks(opponent_id):
    conn = get_db()
    c = conn.cursor()
    uid = current_user_id()

    # verify opponent belongs to user
    owner = c.execute("SELECT user_id FROM opponents WHERE id=?", (opponent_id,)).fetchone()
    if not owner or owner['user_id'] != uid:
        conn.close()
        return jsonify([])

    if request.method == "POST":
        data = request.json
        name = data.get("name", "").strip()
        if not name:
            conn.close()
            return jsonify({"error": "Name required"}), 400
        c.execute(
            "INSERT INTO decks (opponent_id, name, user_id) VALUES (?, ?, ?)",
            (opponent_id, name, uid),
        )
        conn.commit()

    rows = c.execute(
        "SELECT id, name FROM decks WHERE opponent_id=? AND user_id=? ORDER BY name",
        (opponent_id, uid),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# -------- Games --------
@app.route("/api/games", methods=["GET", "POST"])
def games():
    conn = get_db()
    c = conn.cursor()

    if request.method == "POST":
        data = request.json
        players = data.get("players") or []
        if not players:
            conn.close()
            return jsonify({"error": "players array required"}), 400

        # Create game using the first player's opponent/deck as "main" for listing
        first = players[0]
        opponent_id = first.get("opponent_id")
        deck_id = first.get("deck_id")
        if not opponent_id or not deck_id:
            conn.close()
            return jsonify({"error": "invalid players data"}), 400

        uid = current_user_id()

        c.execute(
            "INSERT INTO games (opponent_id, deck_id, user_id) VALUES (?, ?, ?)",
            (opponent_id, deck_id, uid),
        )
        game_id = c.lastrowid

        # Insert players (seats)
        for p in players:
            c.execute("""
                INSERT INTO players (game_id, seat, opponent_id, deck_id)
                VALUES (?, ?, ?, ?)
            """, (game_id, p["seat"], p["opponent_id"], p["deck_id"]))

        conn.commit()
        conn.close()
        return jsonify({"id": game_id})

    # GET: list games, still showing only first seat in summary
    uid = current_user_id()
    rows = c.execute("""
        SELECT g.id, g.timestamp,
               o.name AS opponent, d.name AS deck
        FROM games g
        JOIN opponents o ON g.opponent_id = o.id
        JOIN decks d ON g.deck_id = d.id
        WHERE g.user_id = ?
        ORDER BY g.timestamp DESC
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# -------- Players for a game --------
@app.route("/api/games/<int:game_id>/players", methods=["GET"])
def game_players(game_id):
    conn = get_db()
    c = conn.cursor()
    # ensure the game belongs to current user
    uid = current_user_id()
    owner = c.execute("SELECT user_id FROM games WHERE id=?", (game_id,)).fetchone()
    if not owner or owner['user_id'] != uid:
        conn.close()
        return jsonify([])

    rows = c.execute("""
        SELECT p.id, p.seat,
               o.name AS opponent, d.name AS deck
        FROM players p
        JOIN opponents o ON p.opponent_id = o.id
        JOIN decks d ON p.deck_id = d.id
        WHERE p.game_id=?
        ORDER BY p.seat
    """, (game_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# -------- Trackers --------
@app.route("/api/games/<int:game_id>/trackers", methods=["GET", "POST", "PATCH", "DELETE"])
def trackers(game_id):
    conn = get_db()
    c = conn.cursor()

    # ensure game belongs to current user
    uid = current_user_id()
    owner = c.execute("SELECT user_id FROM games WHERE id=?", (game_id,)).fetchone()
    if not owner or owner['user_id'] != uid:
        conn.close()
        return jsonify({"error": "not found"}), 404

    if request.method == "POST":
        data = request.json
        name = data.get("tracker", "").strip()
        tracker_type = data.get("type", "player")
        if tracker_type not in ("player", "yesno", "number"):
            tracker_type = "player"

        player_seat = data.get("player_seat")
        if tracker_type == "player":
            try:
                player_seat = int(player_seat)
            except (TypeError, ValueError):
                conn.close()
                return jsonify({"error": "player_seat required for player tracker"}), 400
        else:
            player_seat = None

        if not name:
            conn.close()
            return jsonify({"error": "tracker required"}), 400

        # For number trackers, use a numeric value
        value = data.get("value")
        if tracker_type == "number":
            try:
                value = int(value)
            except (TypeError, ValueError):
                conn.close()
                return jsonify({"error": "numeric value required for number tracker"}), 400
        else:
            value = 1  # default increment step

        # Create tracker if not exists
        c.execute("""
            INSERT INTO trackers (game_id, tracker, count, type, player_seat)
            SELECT ?, ?, 0, ?, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM trackers
                WHERE game_id = ? AND tracker = ? AND type = ? AND
                      (player_seat IS ? OR player_seat = ?)
            )
        """, (game_id, name, tracker_type, player_seat,
              game_id, name, tracker_type, player_seat, player_seat))

        if tracker_type == "number":
            # Set count to the provided value
            c.execute("""
                UPDATE trackers
                SET count = ?
                WHERE game_id = ? AND tracker = ? AND type = ? AND
                      (player_seat IS ? OR player_seat = ?)
            """, (value, game_id, name, tracker_type, player_seat, player_seat))
        else:
            # Increment count
            c.execute("""
                UPDATE trackers
                SET count = count + ?
                WHERE game_id = ? AND tracker = ? AND type = ? AND
                      (player_seat IS ? OR player_seat = ?)
            """, (value, game_id, name, tracker_type, player_seat, player_seat))

        conn.commit()



    elif request.method == "PATCH":
        # increment existing tracker by id
        data = request.json
        tracker_id = data.get("id")
        action = data.get("action", "increment")
        if tracker_id is None:
            conn.close()
            return jsonify({"error": "id required"}), 400

        if action == "decrement":
            c.execute("""
                       UPDATE trackers
                       SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END
                       WHERE id = ?
                   """, (tracker_id,))
        elif action == "set_value":
            # For number-type trackers
            value = data.get("value")
            try:
                value = int(value)
            except (TypeError, ValueError):
                conn.close()
                return jsonify({"error": "numeric value required"}), 400
            c.execute("UPDATE trackers SET count = ? WHERE id = ?", (value, tracker_id))
        else:
            c.execute("UPDATE trackers SET count = count + 1 WHERE id = ?", (tracker_id,))

        conn.commit()

    elif request.method == "DELETE":
        data = request.json
        tracker_id = data.get("id")
        if tracker_id is None:
            conn.close()
            return jsonify({"error": "id required"}), 400
        c.execute("DELETE FROM trackers WHERE id=?", (tracker_id,))
        conn.commit()

    rows = c.execute("""
        SELECT
            t.id,
            t.tracker,
            t.count,
            t.type,
            t.player_seat,
            p.seat,
            o.name AS player_name
        FROM trackers t
        LEFT JOIN players p
            ON p.game_id = t.game_id
           AND p.seat = t.player_seat
        LEFT JOIN opponents o
            ON o.id = p.opponent_id
        WHERE t.game_id = ?
        ORDER BY t.tracker
    """, (game_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/stats/overall", methods=["GET"])
def overall_stats():
    conn = get_db()
    c = conn.cursor()
    # Per-tracker breakdowns across all games for current user
    uid = current_user_id()
    trackers_list = []
    distinct = c.execute("SELECT t.tracker, t.type FROM trackers t JOIN games g ON t.game_id = g.id WHERE g.user_id = ? GROUP BY t.tracker, t.type", (uid,)).fetchall()
    for row in distinct:
        name = row["tracker"]
        ttype = row["type"]
        item = {"tracker": name, "type": ttype}
        if ttype == 'player':
            q = c.execute("""
                SELECT o.name AS player_name, COALESCE(SUM(t.count),0) AS total_hits
                FROM trackers t
                JOIN games g ON t.game_id = g.id
                JOIN players p ON p.game_id = t.game_id AND p.seat = t.player_seat
                JOIN opponents o ON o.id = p.opponent_id
                WHERE t.tracker = ? AND t.type = 'player' AND g.user_id = ?
                GROUP BY o.name
                ORDER BY total_hits DESC
            """, (name, uid)).fetchall()
            item["per_player"] = [dict(r) for r in q]
        elif ttype == 'yesno':
            q = c.execute("""
                SELECT COALESCE(SUM(t.count),0) AS yes, COUNT(*) AS instances
                FROM trackers t
                JOIN games g ON t.game_id = g.id
                WHERE t.tracker = ? AND t.type = 'yesno' AND g.user_id = ?
            """, (name, uid)).fetchone()
            if q:
                yes = q["yes"]
                instances = q["instances"]
                no = instances - yes
            else:
                yes = 0
                no = 0
            item["yesno"] = {"yes": yes, "no": no}
        elif ttype == 'number':
            q = c.execute("""
                SELECT t.count AS value, COUNT(*) AS occurrences
                FROM trackers t
                JOIN games g ON t.game_id = g.id
                WHERE t.tracker = ? AND t.type = 'number' AND g.user_id = ?
                GROUP BY t.count
                ORDER BY value
            """, (name, uid)).fetchall()
            item["distribution"] = [dict(r) for r in q]
        trackers_list.append(item)

    conn.close()

    return jsonify({"trackers": trackers_list})


# -------- Managed trackers (global) --------
@app.route("/api/managed_trackers", methods=["GET", "POST"]) 
def managed_trackers():
    conn = get_db()
    c = conn.cursor()
    uid = current_user_id()

    if request.method == "POST":
        data = request.json or {}
        name = (data.get("tracker") or "").strip()
        mtype = data.get("type") or "player"
        if mtype not in ("player", "yesno", "number"):
            mtype = "player"
        if not name:
            conn.close()
            return jsonify({"error": "tracker required"}), 400
        try:
            c.execute("INSERT INTO managed_trackers (tracker, type, user_id) VALUES (?, ?, ?)", (name, mtype, uid))
            conn.commit()
        except sqlite3.IntegrityError:
            # already exists for this user - ignore
            pass

    rows = c.execute("SELECT id, tracker, type FROM managed_trackers WHERE user_id=? ORDER BY tracker", (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/managed_trackers/<int:mt_id>", methods=["PATCH", "DELETE"])
def managed_tracker_item(mt_id):
    conn = get_db()
    c = conn.cursor()

    uid = current_user_id()

    if request.method == "PATCH":
        data = request.json or {}
        name = data.get("tracker")
        mtype = data.get("type")
        if name:
            name = name.strip()
        if mtype and mtype not in ("player", "yesno", "number"):
            mtype = None
        # ensure this item belongs to user
        exists = c.execute("SELECT id FROM managed_trackers WHERE id=? AND user_id=?", (mt_id, uid)).fetchone()
        if not exists:
            conn.close()
            return jsonify({"error": "not found"}), 404
        if name and mtype:
            try:
                c.execute("UPDATE managed_trackers SET tracker=?, type=? WHERE id=? AND user_id=?", (name, mtype, mt_id, uid))
                conn.commit()
            except sqlite3.IntegrityError:
                conn.close()
                return jsonify({"error": "tracker name already exists"}), 400
        elif name:
            try:
                c.execute("UPDATE managed_trackers SET tracker=? WHERE id=? AND user_id=?", (name, mt_id, uid))
                conn.commit()
            except sqlite3.IntegrityError:
                conn.close()
                return jsonify({"error": "tracker name already exists"}), 400
        elif mtype:
            c.execute("UPDATE managed_trackers SET type=? WHERE id=? AND user_id=?", (mtype, mt_id, uid))
            conn.commit()

    elif request.method == "DELETE":
        c.execute("DELETE FROM managed_trackers WHERE id=? AND user_id=?", (mt_id, uid))
        conn.commit()

    conn.close()
    return jsonify({"ok": True})


@app.route("/api/games/<int:game_id>/stats", methods=["GET"])
def game_stats(game_id):
    conn = get_db()
    c = conn.cursor()

    # ensure game belongs to current user
    uid = current_user_id()
    owner = c.execute("SELECT user_id FROM games WHERE id=?", (game_id,)).fetchone()
    if not owner or owner['user_id'] != uid:
        conn.close()
        return jsonify({"error": "not found"}), 404

    # Total trackers by type
    by_type = c.execute("""
        SELECT type, COUNT(*) AS trackers, COALESCE(SUM(count), 0) AS total_hits
        FROM trackers
        WHERE game_id=?
        GROUP BY type
    """, (game_id,)).fetchall()

    # For player trackers: total hits per player
    per_player = c.execute("""
        SELECT
            o.name AS player_name,
            COALESCE(SUM(t.count), 0) AS total_hits
        FROM trackers t
        JOIN players p
          ON p.game_id = t.game_id
         AND p.seat = t.player_seat
        JOIN opponents o
          ON o.id = p.opponent_id
        WHERE t.game_id = ? AND t.type = 'player'
        GROUP BY o.name
        ORDER BY total_hits DESC
    """, (game_id,)).fetchall()

    # Top tracker names (for this game)
    top_trackers = c.execute("""
        SELECT tracker, type, COALESCE(SUM(count), 0) AS total_hits
        FROM trackers
        WHERE game_id=?
        GROUP BY tracker, type
        ORDER BY total_hits DESC
        LIMIT 10
    """, (game_id,)).fetchall()

    conn.close()
    return jsonify({
        "by_type": [dict(r) for r in by_type],
        "per_player": [dict(r) for r in per_player],
        "top_trackers": [dict(r) for r in top_trackers],
    })

init_db()
if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0",debug=True,port=7000)

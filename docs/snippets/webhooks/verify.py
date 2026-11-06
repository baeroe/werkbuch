import hashlib
import hmac
import re
import time


def verify_werkbuch_signature(secret, timestamp, body, signature_header, now=None):
    """Checks a request from werkbuch.

    `X-Werkbuch-Signature` must be `sha256=` and the hex HMAC-SHA256 of "<X-Werkbuch-Timestamp>.<body>" with the
    secret of the webhook, and the timestamp at most 300 seconds away from now (against replays). Pass the body
    exactly as it arrived (bytes, or a str), before parsing it as JSON. A missing (None) or malformed header is no
    valid signature: the function answers False, it never raises.
    """
    if not isinstance(timestamp, str) or not isinstance(signature_header, str):
        return False
    if not re.fullmatch(r"[0-9]{1,10}", timestamp):
        return False
    if abs((int(time.time()) if now is None else now) - int(timestamp)) > 300:
        return False

    raw = body.encode("utf-8") if isinstance(body, str) else body
    digest = hmac.new(secret.encode("utf-8"), timestamp.encode("ascii") + b"." + raw, hashlib.sha256).hexdigest()
    # compared in constant time, as bytes: a header with other characters than ASCII is simply not equal
    return hmac.compare_digest(("sha256=" + digest).encode("ascii"), signature_header.encode("utf-8"))

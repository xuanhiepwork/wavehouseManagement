"""Business-calendar helpers independent of a host machine's timezone.

Vietnam uses UTC+07:00 for the business dates accepted by this service.  A
fixed offset avoids requiring an operating-system timezone database on Windows.
No holiday calendar is inferred: holiday/special-day signals must be supplied
by the authorized upstream data contract.
"""

from datetime import date, datetime, time, timedelta, timezone


BUSINESS_TIMEZONE_NAME = "Asia/Ho_Chi_Minh"
BUSINESS_TIMEZONE = timezone(timedelta(hours=7), BUSINESS_TIMEZONE_NAME)


def target_date_cutoff(business_date: date) -> datetime:
    """Return the beginning of a target day in Vietnam, as an aware datetime.

    Histories must be strictly earlier than this instant.  In particular, an
    observation approved on the target day is not available to that day's
    date-level forecast even when its business date is earlier.
    """
    if not isinstance(business_date, date) or isinstance(business_date, datetime):
        raise ValueError("business_date must be a date without a time component")
    return datetime.combine(business_date, time.min, tzinfo=BUSINESS_TIMEZONE)


def available_before(available_at: datetime, cutoff: datetime) -> bool:
    """Compare event availability without treating naive local time as UTC."""
    if available_at.tzinfo is None or available_at.utcoffset() is None:
        raise ValueError("available_at must include a timezone offset")
    if cutoff.tzinfo is None or cutoff.utcoffset() is None:
        raise ValueError("cutoff must include a timezone offset")
    return available_at < cutoff


def calendar_features(business_date: date) -> tuple[int, bool]:
    """Monday is 0 and Sunday is 6; weekends are Saturday and Sunday."""
    target_date_cutoff(business_date)
    weekday = business_date.weekday()
    return weekday, weekday >= 5

from stripe_terminal_readers import firmware_outliers, reader_state

NOW_MS = 1_756_000_000_000
HOUR = 3_600_000


def test_a_seconds_timestamp_is_refused_not_believed():
    # 1756000000 is a perfectly good seconds timestamp and a nonsense millisecond
    # one. Reporting it as 50 years stale is how this check gets ignored.
    state, detail = reader_state("online", NOW_MS // 1000, NOW_MS)
    assert state == "unknown"
    assert "seconds timestamp" in detail


def test_recent_check_in_on_an_online_reader_is_fine():
    state, _ = reader_state("online", NOW_MS - HOUR, NOW_MS)
    assert state == "online"


def test_stale_beats_a_cheerful_status():
    # status lags reality, so six hours without a check-in is unusable even while
    # the reader still claims to be online.
    assert reader_state("online", NOW_MS - 5 * HOUR, NOW_MS)[0] == "online"
    state, detail = reader_state("online", NOW_MS - 6 * HOUR, NOW_MS)
    assert state == "stale"
    assert "status lags reality" in detail


def test_offline_and_wedged_are_different_problems():
    assert reader_state("offline", NOW_MS - HOUR, NOW_MS)[0] == "offline"
    state, detail = reader_state("online", NOW_MS - HOUR, NOW_MS,
                                 "failed", "reader_timeout")
    assert state == "action_failed"
    assert "reader_timeout" in detail


def test_firmware_outliers_need_a_majority_to_be_outliers_from():
    fleet = [
        {"id": "tmr_1", "device_type": "bbpos_wisepos_e", "device_sw_version": "2.24"},
        {"id": "tmr_2", "device_type": "bbpos_wisepos_e", "device_sw_version": "2.24"},
        {"id": "tmr_3", "device_type": "bbpos_wisepos_e", "device_sw_version": "2.11"},
        {"id": "tmr_4", "device_type": "stripe_s700", "device_sw_version": "1.4"},
    ]
    out = firmware_outliers(fleet)
    assert [row[0] for row in out] == ["tmr_3"]
    assert out[0][3] == "2.24"

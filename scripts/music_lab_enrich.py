"""Adds Discogs and Genius credits to a Music Lab snapshot built from MusicBrainz (see update_music_lab.py).

Everything fetched is cached in the snapshot itself (the "cache" block), so daily runs only fetch what is new
or older than the refresh window, and a source that fails keeps its last data.
"""

from datetime import datetime, timedelta
import re
import sys
import time

import music_lab_sources as src

MB = "https://musicbrainz.org/ws/2"
DISCOGS = "https://api.discogs.com"
DISCOGS_DAYS = 60
GENIUS_DAYS = 30
MISS_DAYS = 14
ARTIST_RELEASE_LIMIT = 120


def fresh(stamp, now, days):
    try:
        return now - datetime.fromisoformat(stamp.replace("Z", "+00:00")) < timedelta(days=days)
    except (AttributeError, ValueError):
        return False


def track_key(release_id, position):
    return f"{release_id}:{position}"


def discogs_ids(person):
    ids = []
    for url in person.get("discogsUrls") or []:
        kind, number = src.discogs_link(url)
        if kind == "artist" and number not in ids:
            ids.append(number)
    return ids


def discogs_phase(mb_client, people, recordings, previous, now, deadline):
    """Returns (tracks, cache, status). tracks: {key: track} for every Discogs track tied to the snapshot."""
    stamp = now.isoformat(timespec="seconds")
    old_cache = (previous.get("cache") or {}).get("discogs") or {}
    cache = {"mbReleases": dict(old_cache.get("mbReleases") or {}), "masters": dict(old_cache.get("masters") or {}),
             "artists": dict(old_cache.get("artists") or {}), "releases": dict(old_cache.get("releases") or {})}
    old_tracks = previous.get("discogsTracks") or {}
    api, authenticated = src.discogs_client(min(deadline, time.monotonic() + 14 * 60))
    status = {"status": "ok", "authenticated": authenticated, "message": ""}
    stopped = False

    def stop(error):
        nonlocal stopped
        stopped = True
        if str(error) != "budget":
            print(f"Discogs phase stopped: {error}", file=sys.stderr)
            status.update(status="partial", message=str(error)[:200])
        else:
            status.update(status="partial", message="Request budget reached; the rest is fetched on the next run.")

    # 1. MusicBrainz releases -> Discogs release or master, through MusicBrainz's own links.
    for recording in recordings.values():
        mb_release = (recording.get("release") or {}).get("id")
        if not mb_release or stopped:
            continue
        entry = cache["mbReleases"].get(mb_release)
        if entry and fresh(entry.get("checkedAt"), now, DISCOGS_DAYS if entry.get("release") or entry.get("master") else MISS_DAYS):
            continue
        try:
            data = mb_client.get(f"{MB}/release/{mb_release}?inc=url-rels+release-groups+release-group-level-rels&fmt=json") or {}
        except Exception as error:  # Budget or network: keep going with what we have.
            stop(error if str(error) else "budget")
            break
        release_link = master_link = None
        for relation in data.get("relations") or []:
            kind, number = src.discogs_link((relation.get("url") or {}).get("resource"))
            if kind == "release":
                release_link = number
        for relation in (data.get("release-group") or {}).get("relations") or []:
            kind, number = src.discogs_link((relation.get("url") or {}).get("resource"))
            if kind == "master":
                master_link = number
        cache["mbReleases"][mb_release] = {"release": release_link, "master": master_link, "checkedAt": stamp}

    # 2. Masters (album-level links) -> their main release.
    for entry in list(cache["mbReleases"].values()):
        master = entry.get("master")
        if stopped or entry.get("release") or not master:
            continue
        known = cache["masters"].get(str(master))
        if known and fresh(known.get("checkedAt"), now, DISCOGS_DAYS):
            continue
        try:
            data = api.get(f"{DISCOGS}/masters/{master}") or {}
        except Exception as error:
            stop(error)
            break
        cache["masters"][str(master)] = {"main": data.get("main_release"), "checkedAt": stamp}

    # 3. Releases each tracked person is credited on, from their Discogs artist pages.
    person_items = {}
    for person in people:
        items = []
        for artist_id in discogs_ids(person):
            known = cache["artists"].get(str(artist_id))
            if not (known and fresh(known.get("checkedAt"), now, DISCOGS_DAYS)) and not stopped:
                collected = []
                try:
                    for page in range(1, 4):
                        data = api.get(f"{DISCOGS}/artists/{artist_id}/releases?per_page=100&page={page}&sort=year&sort_order=desc") or {}
                        for item in data.get("releases") or []:
                            release_id = item.get("id") if item.get("type") == "release" else item.get("main_release")
                            if release_id and item.get("role") != "Main":
                                collected.append([release_id, item.get("role", ""), item.get("year") or 0])
                        if page >= ((data.get("pagination") or {}).get("pages") or 1):
                            break
                    known = {"items": collected, "checkedAt": stamp}
                    cache["artists"][str(artist_id)] = known
                except Exception as error:
                    stop(error)
            items.extend((known or {}).get("items") or [])
        items.sort(key=lambda item: -(item[2] or 0))
        person_items[person.get("key")] = items[:ARTIST_RELEASE_LIMIT]

    # 4. Fetch the releases we need and keep the relevant tracks.
    def discogs_release_for(mb_release):
        entry = cache["mbReleases"].get(mb_release) or {}
        if entry.get("release"):
            return entry["release"]
        main = (cache["masters"].get(str(entry.get("master"))) or {}).get("main")
        return main or None

    wanted = {}  # discogs release id -> {"recordings": [...], "artists": set(person discogs ids)}
    for recording_id, recording in recordings.items():
        release_id = discogs_release_for((recording.get("release") or {}).get("id"))
        if release_id:
            wanted.setdefault(release_id, {"recordings": [], "artists": set()})["recordings"].append(recording_id)
    for person in people:
        ids = set(discogs_ids(person))
        for release_id, _role, _year in person_items.get(person.get("key"), []):
            wanted.setdefault(release_id, {"recordings": [], "artists": set()})["artists"].update(ids)

    tracks = {}
    for release_id, need in wanted.items():
        known = cache["releases"].get(str(release_id)) or {}
        attempted = set(known.get("recordings") or [])
        reuse = fresh(known.get("checkedAt"), now, DISCOGS_DAYS) and set(need["recordings"]) <= attempted \
            and set(need["artists"]) <= set(known.get("artists") or [])
        if reuse or stopped:
            for key, track in old_tracks.items():
                if track.get("release") == release_id:
                    tracks[key] = dict(track)
            continue
        try:
            data = api.get(f"{DISCOGS}/releases/{release_id}")
        except Exception as error:
            stop(error)
            for key, track in old_tracks.items():
                if track.get("release") == release_id:
                    tracks[key] = dict(track)
            continue
        cache["releases"][str(release_id)] = {"checkedAt": stamp, "recordings": sorted(attempted | set(need["recordings"])),
                                              "artists": sorted(set(known.get("artists") or []) | need["artists"])}
        if not data:
            continue
        release_tracks = src.discogs_tracks(data)
        keep = {}
        for recording_id in need["recordings"]:
            recording = recordings[recording_id]
            match = src.match_track(release_tracks, recording.get("title"), [artist.get("name") for artist in recording.get("artists") or []])
            if match:
                keep[match["position"]] = match
        for track in release_tracks:
            if need["artists"] & {credit.get("id") for credit in track["credits"]}:
                keep[track["position"]] = track
        for position, track in keep.items():
            tracks[track_key(release_id, position)] = {**track, "release": release_id, "releaseTitle": data.get("title", ""),
                                                       "year": data.get("year") or 0, "url": data.get("uri", ""), "fetchedAt": stamp}

    # 5. Link tracks to MusicBrainz recordings and to people.
    by_release = {}
    for key, track in tracks.items():
        by_release.setdefault(track["release"], []).append((key, track))
        track.pop("recording", None)
    for recording_id, recording in recordings.items():
        recording.pop("discogs", None)
        release_id = discogs_release_for((recording.get("release") or {}).get("id"))
        candidates = [track for _key, track in by_release.get(release_id, [])]
        match = src.match_track(candidates, recording.get("title"), [artist.get("name") for artist in recording.get("artists") or []]) if candidates else None
        if match:
            key = track_key(release_id, match["position"])
            recording["discogs"] = key
            tracks[key]["recording"] = recording_id
    # A credited Discogs track that is the same song as one of the person's MusicBrainz recordings points to it.
    titles = {}
    for recording_id, recording in recordings.items():
        titles.setdefault(src.normalize(recording.get("title")), []).append((recording_id, {src.normalize(a.get("name")) for a in recording.get("artists") or []}))
    for person in people:
        ids = set(discogs_ids(person))
        keys = []
        for key, track in tracks.items():
            if ids & {credit.get("id") for credit in track["credits"]}:
                keys.append(key)
                if "recording" not in track:
                    for recording_id, artists in titles.get(src.normalize(track["title"]), []):
                        if artists & {src.normalize(name) for name in track["artists"]}:
                            track["recording"] = recording_id
                            break
        person["discogsIds"] = sorted(ids)
        person["discogsTracks"] = sorted(keys, key=lambda key: (-(tracks[key].get("year") or 0), key))
    status["requests"] = api.used
    return tracks, cache, status


def genius_phase(people, recordings, tracks, previous, now, deadline):
    """Adds Genius song ids to recordings and Discogs-only tracks. Skipped (keeping old data) without a token."""
    stamp = now.isoformat(timespec="seconds")
    old_cache = (previous.get("cache") or {}).get("genius") or {}
    lookups = dict(old_cache.get("lookups") or {})
    songs = dict(previous.get("geniusSongs") or {})
    api = src.genius_client(deadline)
    status = {"status": "ok" if api else "off", "message": "" if api else "No Genius token is configured; showing the last Genius credits saved."}
    targets = [(f"mb:{rid}", recording.get("title"), [a.get("name") for a in recording.get("artists") or []], recordings[rid]) for rid, recording in recordings.items()]
    targets += [(f"dg:{key}", track.get("title"), track.get("artists") or [], track) for key, track in tracks.items() if not track.get("recording")]
    for lookup_key, title, artists, holder in targets:
        entry = lookups.get(lookup_key)
        if api and not (entry and fresh(entry.get("checkedAt"), now, GENIUS_DAYS if entry.get("song") else MISS_DAYS)):
            try:
                hits = ((api.get(src.genius_search_url(artists[0] if artists else "", title)) or {}).get("response") or {}).get("hits") or []
                result = src.genius_pick(hits, title, artists)
                entry = {"song": result.get("id") if result else None, "checkedAt": stamp}
                lookups[lookup_key] = entry
                song_id = entry["song"]
                if song_id and not fresh((songs.get(str(song_id)) or {}).get("fetchedAt"), now, GENIUS_DAYS):
                    song = ((api.get(f"https://api.genius.com/songs/{song_id}?text_format=plain") or {}).get("response") or {}).get("song") or {}
                    if song:
                        songs[str(song_id)] = {"id": song_id, "url": song.get("url", ""), "title": song.get("title", ""),
                                               "artist": (song.get("primary_artist") or {}).get("name", ""),
                                               "credits": src.genius_song_credits(song), "fetchedAt": stamp}
            except Exception as error:
                if str(error) != "budget":
                    print(f"Genius phase stopped: {error}", file=sys.stderr)
                status.update(status="partial", message="Genius stopped early; the rest is fetched on the next run." if str(error) == "budget" else str(error)[:200])
                api = None
        holder.pop("genius", None)
        if entry and entry.get("song") and str(entry["song"]) in songs:
            holder["genius"] = str(entry["song"])
    used = {holder_id for holder_id in (r.get("genius") for r in list(recordings.values()) + list(tracks.values())) if holder_id}
    songs = {key: value for key, value in songs.items() if key in used}
    return songs, {"lookups": lookups}, status

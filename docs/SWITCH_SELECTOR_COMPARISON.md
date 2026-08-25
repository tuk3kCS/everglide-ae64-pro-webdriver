# Wooting and Everglide switch-selector comparison

This analysis compares the root `wootility.io.har` capture with `xsyd.top.har` and the JavaScript responses stored inside both captures. The Wooting capture identifies Wootility Web 5.4.1, a Wooting 60HE ARM, and firmware 2.14.0. The Everglide request identifies AE64 board `0030000a`, USB VID `1ca6`, and PID `300a`.

## Important capture limit

A HAR records HTTP traffic and downloaded application assets. It does **not** record WebHID report traffic between the browser and keyboard. The Wooting HID packet bytes therefore cannot be recovered from this file. The client bundle still exposes the data model and the calls it makes to its HID abstraction, while the Everglide packet layout is also available from the separate captures and recovered protocol code.

## Main difference

Wooting treats installed switches as a device-wide **sensor configuration profile** that can contain different switch types for different keys. Everglide stores switch calibration metadata directly inside each key's ordinary performance record.

| Area | Wooting | Everglide AE64 |
|---|---|---|
| Catalog source | Calls `getSupportedSwitches()` on the connected keyboard and maps the returned switch types. The bundle also contains generic switch metadata and bundled artwork. | Downloads `getAxisListV3` from the manufacturer's API using board ID, VID, and PID. The captured AE64 response contains 82 profiles in five groups. |
| Per-key model | Builds a full key matrix. Keys with the same switch are compressed into a base switch plus exception `switchGroup` records containing key coordinates. | Selecting a switch writes `axisV2Id`, `axisRangeMax`, and `axisCoefficient` into each selected key's performance record. |
| Stored metadata | Generic switch `type`, steps per millimeter, supported min/max range, sort order, and an optional per-switch `spacer` adjustment. | Detailed axis ID, maximum range, and magnetic-response coefficient. The API also supplies brand, color, flux, and display metadata. |
| Relationship to actuation | Sensor configuration is separate from the normal actuation/profile controller. | Switch identity and actuation/RT/dead-zone values share the same per-key performance packet. The original UI preserves tuning and calibration fields while replacing the three switch fields. |
| Persistence | `saveProfile()` for the sensor controller is empty; `save()` writes a global `SensorConfigProfile` to the device. The captured public profile upload contains no switch-selection field. | Switch assignment follows the normal per-key performance save path and is therefore part of the AE64 onboard profile state. |
| Compatibility behavior | Uses only the switch types reported as supported by the connected keyboard. The bundle has default switch types per device family, `Unknown`/`UnknownStem` artwork, and validates unsupported types. | The server returns a board-specific list. The original driver does not provide an equivalent explicit unknown-switch choice in the captured 82-profile response. |
| Images | The capture requests 48 switch image assets: 24 unique top-view files, 23 unique side-view files, and one Flaretech image. Several product variants have separate artwork. | All 82 captured AE64 entries use `image_url: "#"`; the original selector reuses a generic image. This alternative driver therefore provides local image overrides. |
| Offline behavior | Names/graphics and generic metadata are bundled, while the connected device determines its supported subset. | The original UI depends on a remote board-specific catalog request. This project snapshots that response locally to remove the runtime latency and dependency. |

## Wooting's storage strategy

The downloaded Wootility code converts the keyboard's supported switch records into a map. Its sensor profile has:

- one `base` switch used for the majority of keys;
- zero or more `switchGroup` exceptions, each containing a switch definition and a list of physical key coordinates;
- validation against the supported switch map and device limits for keys and groups.

When writing, the client groups keys that share an identical switch definition, promotes the largest group to `base`, and stores the other groups as exceptions. When reading, it expands those groups back into a per-key matrix. This is compact and makes a uniform board cheap to store while still supporting mixed-switch installations.

The captured public-profile POST contains normal analog fields such as `actPoint`, `rapidTrigger`, `rapidTriggerSensitivity`, and `perKeyRapidTrigger`, but no switch or sensor-configuration property. Together with the separate `setSensorConfigProfile` save path in the client, this shows that switch selection is device-global rather than part of a shared typing/gaming profile.

## Everglide's storage strategy

The original AE64 client loads 82 entries from `getAxisListV3`. Its selector code takes `aixsDetail[0]` from the chosen item and copies:

```text
axis_id          -> axisV2Id
axis_range_max   -> axisRangeMax
axis_coefficient -> axisCoefficient
```

It does this separately for every selected key, while retaining that key's actuation, RT, dead-zone, and calibration values. The write packet therefore couples switch calibration metadata and key tuning. It is simpler than Wooting's base-plus-exception structure, but it repeats the switch metadata and makes verification sensitive to firmware-normalized fields.

## Design consequence for this project

The AE64 alternative should keep using its native three-field per-key write; copying Wooting's sensor-profile format would be protocol-incompatible. The useful Wooting ideas are UI and data-management patterns:

- show the assigned switch name directly on every key while selecting switches;
- allow mixed switches through ordinary multi-key selection;
- keep human-facing names and artwork separate from firmware IDs;
- validate the switch ID strictly but accept firmware-authoritative normalization of auxiliary calibration metadata;
- provide an explicit unknown/fallback presentation when an onboard ID is missing from the local snapshot.

`catalog-overrides.json` implements the display-data separation without changing any captured AE64 firmware value.

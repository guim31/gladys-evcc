# evcc

This integration brings [evcc](https://evcc.io) into Gladys. evcc controls the charging of electric
vehicles with solar surplus, dynamic tariffs or a charging plan. Gladys follows evcc live (solar
production, home, grid, battery, loadpoints, vehicles), changes the charging mode and the limits,
and runs scenes when a vehicle is plugged in or a charge finishes.

The integration talks to evcc on your local network, without any cloud. It was developed and tested
against evcc's demo mode (versions 0.210 and 0.317), **without a real charger: feedback welcome**.

## Requirements

- Gladys Assistant 5.1 or newer.
- evcc running on your network (Raspberry Pi, Docker, Home Assistant…), version 0.200 or newer
  recommended. Older versions are read as well as possible.
- The address of evcc, as you open it in your browser, for example `http://192.168.1.20:7070`.
  Gladys must be able to reach it.

## Configuration

1. **Integrations → evcc**, then **Configuration**.
2. **evcc address**: the address of its web interface. Without a port, 7070 is used. Behind a
   reverse proxy, a path is allowed (`https://example.org/evcc`).
3. **Admin password**: optional. Recent evcc versions change the mode and the limits without it. If
   your evcc (or your proxy) answers "unauthorized", enter it.
4. **Language of the feature names**: French by default. The names are frozen when you add the
   device.
5. Save, then click **Test the connection**: the evcc version and the number of loadpoints and
   vehicles are shown.
6. In the **Discover** tab, add the devices you want.

The integration follows evcc through its websocket: values arrive at every evcc cycle (30 s by
default). If the websocket drops, it reads the state every 30 s and reconnects by itself.

## The devices

### Site

One device named after your evcc site, with what evcc measures:

| Feature          | Detail                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Solar production | W, if evcc has a PV meter                                              |
| Home consumption | W                                                                      |
| Grid             | W, positive when the house imports, negative when it exports           |
| Home battery     | level in %, charging and discharging power in W, if there is a battery |
| Grid price       | current price of a kWh, if a tariff is configured in evcc              |

### Loadpoint

One device per evcc loadpoint:

| Feature             | Detail                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Mode                | **controllable**: Off, Solar, Min + solar, Fast                                                            |
| Charging state      | charging, plugged in, waiting (evcc waits for the sun or a slot), paused (vehicle full), idle              |
| Vehicle plugged in  | yes or no                                                                                                  |
| Charging power      | kW                                                                                                         |
| Charging current    | A                                                                                                          |
| Session energy      | kWh charged since plugging in                                                                              |
| Time remaining      | minutes, evcc's estimate while charging                                                                    |
| Charge limit        | **controllable**: battery level aimed at for this session, in %                                            |
| Vehicle             | name of the vehicle evcc identified                                                                        |
| Cheap grid charging | evcc charges because the grid is cheap (dynamic tariff)                                                    |
| Charger meter       | index in kWh, if the charger has a meter: Gladys derives its consumption and cost in the energy monitoring |

Since evcc 0.317, the "Solar" mode is called **Smart** in evcc, and "Min + solar" is Smart with the
**Always charge** option. The integration keeps the four historical modes, understood by every
evcc version.

An integrated device (heat pump, socket switched by evcc) only has the mode, the state, the power,
the energy and the meter.

### Vehicle

One device per vehicle configured in evcc:

| Feature       | Detail                                                               |
| ------------- | -------------------------------------------------------------------- |
| Battery level | %, known while the vehicle is plugged in (the last value stays)      |
| Range         | km, likewise                                                         |
| Charge limit  | **controllable**: maximum battery level of the vehicle in evcc, in % |
| Plugged in    | the vehicle is plugged into a loadpoint                              |
| Charging plan | the next plan (level and time), or "No plan"                         |

## Dashboard widget

The **evcc** widget shows the energy flow (solar, home, grid in kW), the home battery, the grid price
and one row per loadpoint (state, power, mode). Four buttons change the mode of a loadpoint: the one
chosen in the widget settings, otherwise the first one. The current mode carries a check mark. If
evcc stops answering, the widget shows the last known values, without buttons.

## Scene triggers

| Trigger               | When                                                                 | Variables                                                                  |
| --------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Vehicle plugged in    | a vehicle is plugged in, once evcc identified it (2 minutes at most) | loadpoint, vehicle                                                         |
| Vehicle unplugged     | a vehicle is unplugged                                               | loadpoint, vehicle, energy charged (kWh), time plugged in (minutes)        |
| Charging started      | a charge starts; a short pause (clouds) is not a new charge          | loadpoint, vehicle, mode                                                   |
| Charging finished     | the charge stopped for 10 minutes, or the vehicle was unplugged      | loadpoint, vehicle, energy (kWh), charging time (minutes), solar share (%) |
| Charging mode changed | the mode of a loadpoint changes, in evcc or from Gladys              | loadpoint, new mode, previous mode                                         |

In a message, a variable is written `{{triggerEvent.data.vehicle}}`, `{{triggerEvent.data.energy_kwh}}`…

Each trigger can be limited to a loadpoint and, except the mode change, to a vehicle. The mode
change can be limited to one mode.

## Scene actions

| Action                | Effect                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Set the charging mode | Off, Solar, Min + solar or Fast on a loadpoint                                                     |
| Set a charge limit    | battery level (%) of a loadpoint or a vehicle, or energy (kWh) of a loadpoint; 0 removes the limit |

A refused action (evcc unreachable, value out of range, a device that is not a loadpoint) fails with
a clear message, and the scene goes on.

## Scene examples

- **Fast charge in the evening if the battery is low**: at 9 pm, if the battery level of the vehicle
  is below 30 %, set the mode of the loadpoint to Fast, then set the limit to 60 %.
- **Know when the car is full**: trigger "Charging finished" on your vehicle, send "Charge
  finished: `{{triggerEvent.data.energy_kwh}}` kWh, `{{triggerEvent.data.solar_percent}}` % solar".
- **Back to solar when leaving**: trigger "Vehicle unplugged", set the mode to Solar so that the next
  charge starts on the surplus again.

## Troubleshooting

- **"evcc does not answer at the configured address"**: open the address in a browser from the
  network of Gladys. Check the port (7070 by default) and that no firewall blocks Gladys.
- **"The configured address does not answer like evcc"**: the address points to another service, or
  a proxy returns an error page.
- **"evcc asks for its admin password"**: enter it in the configuration.
- **The battery level of a vehicle does not move**: evcc only reads the vehicle while it is plugged
  in (or if it has a car maker integration). The last value stays shown.
- **"Vehicle plugged in" comes with an empty vehicle**: evcc did not identify the vehicle within
  2 minutes. Check the identification in evcc, or set a default vehicle on the loadpoint.
- **Detailed logs**: add the variable `LOG_LEVEL=debug` to the container.

## Limitations

- One evcc instance per installation of the integration.
- Charging plans are read but not created from Gladys (use evcc).
- Repeating plans (every weekday) are not shown.
- The number of phases, the minimum and maximum current, the home battery and the advanced settings
  stay in evcc.
- Developed without a real charger, against evcc's demo mode: feedback welcome on the Gladys forum.
- Independent project, not affiliated with evcc.

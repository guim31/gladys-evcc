# evcc

Esta integración trae [evcc](https://evcc.io) a Gladys. evcc controla la carga de los vehículos
eléctricos con el excedente solar, las tarifas dinámicas o un plan de carga. Gladys sigue evcc en
directo (producción solar, casa, red, batería, puntos de carga, vehículos), cambia el modo de carga
y los límites, y ejecuta escenas cuando se conecta un vehículo o termina una carga.

La integración habla con evcc en su red local, sin nube. Se desarrolló y probó contra el modo demo
de evcc (versiones 0.210 y 0.317), **sin cargador real: sus comentarios son bienvenidos**.

## Requisitos

- Gladys Assistant 5.1 o más reciente.
- Un evcc funcionando en su red (Raspberry Pi, Docker, Home Assistant…), se recomienda la versión
  0.200 o más reciente. Las versiones anteriores se leen lo mejor posible.
- La dirección de evcc, tal como la abre en su navegador, por ejemplo `http://192.168.1.20:7070`.
  Gladys debe poder alcanzarla.

## Configuración

1. **Integraciones → evcc**, luego **Configuración**.
2. **Dirección de evcc**: la dirección de su interfaz web. Sin puerto, se usa el 7070. Detrás de un
   proxy inverso, se admite una ruta (`https://example.org/evcc`).
3. **Contraseña de administrador**: opcional. Las versiones recientes de evcc cambian el modo y los
   límites sin ella. Si su evcc (o su proxy) responde «no autorizado», introdúzcala.
4. **Idioma de los nombres de funciones**: francés por defecto. Los nombres se fijan al añadir el
   dispositivo.
5. Guarde y haga clic en **Probar la conexión**: se muestran la versión de evcc y el número de
   puntos de carga y vehículos.
6. En la pestaña **Descubrir**, añada los dispositivos que desee.

La integración sigue evcc por su websocket: los valores llegan en cada ciclo de evcc (30 s por
defecto). Si el websocket cae, lee el estado cada 30 s y se reconecta sola.

## Los dispositivos

### Sitio

Un dispositivo con el nombre de su sitio evcc, con lo que evcc mide:

| Función            | Detalle                                                               |
| ------------------ | --------------------------------------------------------------------- |
| Producción solar   | W, si evcc tiene un contador fotovoltaico                             |
| Consumo de la casa | W                                                                     |
| Red                | W, positivo cuando la casa consume de la red, negativo cuando inyecta |
| Batería de la casa | nivel en %, potencia de carga y de descarga en W, si hay batería      |
| Precio de la red   | precio actual del kWh, si hay una tarifa configurada en evcc          |

### Punto de carga

Un dispositivo por punto de carga de evcc:

| Función               | Detalle                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Modo                  | **controlable**: Apagado, Solar, Mín + solar, Rápido                                                                 |
| Estado de la carga    | cargando, conectado, en espera (evcc espera el sol o una franja), pausa (vehículo lleno), inactivo                   |
| Vehículo conectado    | sí o no                                                                                                              |
| Potencia de carga     | kW                                                                                                                   |
| Corriente de carga    | A                                                                                                                    |
| Energía de la sesión  | kWh cargados desde la conexión                                                                                       |
| Tiempo restante       | minutos, estimación de evcc durante la carga                                                                         |
| Límite de carga       | **controlable**: nivel de batería objetivo para esta sesión, en %                                                    |
| Vehículo              | nombre del vehículo identificado por evcc                                                                            |
| Carga a precio bajo   | evcc carga porque la red está barata (tarifa dinámica)                                                               |
| Contador del cargador | índice en kWh, si el cargador tiene contador: Gladys deduce de él el consumo y su coste en el seguimiento de energía |

Desde evcc 0.317, el modo «Solar» se llama **Smart** en evcc, y «Mín + solar» es Smart con la opción
**Cargar siempre**. La integración conserva los cuatro modos históricos, que entiende cualquier
versión de evcc.

Un equipo integrado (bomba de calor, enchufe controlado por evcc) solo tiene el modo, el estado, la
potencia, la energía y el contador.

### Vehículo

Un dispositivo por vehículo configurado en evcc:

| Función          | Detalle                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| Nivel de batería | %, conocido cuando el vehículo está conectado (se conserva el último valor) |
| Autonomía        | km, igual                                                                   |
| Límite de carga  | **controlable**: nivel máximo de batería del vehículo en evcc, en %         |
| Conectado        | el vehículo está conectado a un punto de carga                              |
| Plan de carga    | el próximo plan (nivel y hora), o «Ningún plan»                             |

## Widget del panel

El widget **evcc** muestra el flujo de energía (solar, casa, red en kW), la batería de la casa, el
precio de la red y una línea por punto de carga (estado, potencia, modo). Cuatro botones cambian el
modo de un punto de carga: el elegido en los ajustes del widget, si no el primero. El modo actual
lleva una marca. Si evcc deja de responder, el widget muestra los últimos valores conocidos, sin
botones.

## Disparadores de escena

| Disparador             | Cuándo                                                                        | Variables                                                                           |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Vehículo conectado     | se conecta un vehículo, una vez identificado por evcc (2 minutos como máximo) | punto de carga, vehículo                                                            |
| Vehículo desconectado  | se desconecta un vehículo                                                     | punto de carga, vehículo, energía cargada (kWh), tiempo conectado (minutos)         |
| Carga iniciada         | empieza una carga; una pausa corta (nubes) no es una carga nueva              | punto de carga, vehículo, modo                                                      |
| Carga terminada        | la carga lleva 10 minutos parada, o el vehículo se desconectó                 | punto de carga, vehículo, energía (kWh), tiempo de carga (minutos), parte solar (%) |
| Modo de carga cambiado | el modo de un punto de carga cambia, en evcc o desde Gladys                   | punto de carga, modo nuevo, modo anterior                                           |

En un mensaje, una variable se escribe `{{triggerEvent.data.vehicle}}`, `{{triggerEvent.data.energy_kwh}}`…

Cada disparador puede limitarse a un punto de carga y, salvo el cambio de modo, a un vehículo. El
cambio de modo puede limitarse a un modo.

## Acciones de escena

| Acción                   | Efecto                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Cambiar el modo de carga | Apagado, Solar, Mín + solar o Rápido en un punto de carga                                                           |
| Fijar un límite de carga | nivel de batería (%) de un punto de carga o de un vehículo, o energía (kWh) de un punto de carga; 0 quita el límite |

Una acción rechazada (evcc inalcanzable, valor fuera de rango, un dispositivo que no es un punto de
carga) falla con un mensaje claro, y la escena continúa.

## Ejemplos de escenas

- **Carga rápida por la noche si la batería está baja**: a las 21 h, si el nivel de batería del
  vehículo está por debajo del 30 %, poner el punto de carga en Rápido y fijar el límite en 60 %.
- **Saber cuándo el coche está lleno**: disparador «Carga terminada» en su vehículo, enviar «Carga
  terminada: `{{triggerEvent.data.energy_kwh}}` kWh, `{{triggerEvent.data.solar_percent}}` % solar».
- **Volver al solar al salir**: disparador «Vehículo desconectado», poner el modo en Solar para que
  la próxima carga empiece de nuevo con el excedente.

## Solución de problemas

- **«evcc no responde en la dirección configurada»**: abra la dirección en un navegador desde la red
  de Gladys. Compruebe el puerto (7070 por defecto) y que ningún cortafuegos bloquee Gladys.
- **«La dirección configurada no responde como evcc»**: la dirección apunta a otro servicio, o un
  proxy devuelve una página de error.
- **«evcc pide su contraseña de administrador»**: introdúzcala en la configuración.
- **El nivel de batería de un vehículo no cambia**: evcc solo lee el vehículo mientras está conectado
  (o si tiene una integración del fabricante). Se sigue mostrando el último valor.
- **«Vehículo conectado» llega con un vehículo vacío**: evcc no identificó el vehículo en 2 minutos.
  Compruebe la identificación en evcc, o asigne un vehículo por defecto al punto de carga.
- **Registros detallados**: añada la variable `LOG_LEVEL=debug` al contenedor.

## Limitaciones

- Una sola instancia de evcc por instalación de la integración.
- Los planes de carga se leen pero no se crean desde Gladys (use evcc).
- Los planes repetitivos (cada día de la semana) no se muestran.
- El número de fases, la corriente mínima y máxima, la batería de la casa y los ajustes avanzados
  quedan en evcc.
- Desarrollada sin cargador real, contra el modo demo de evcc: sus comentarios son bienvenidos en el
  foro de Gladys.
- Proyecto independiente, no afiliado a evcc.

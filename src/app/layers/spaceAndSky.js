import { createSatelliteGroupsLayer } from '../../layers/satelliteGroups/index.js';
import { createCrewedStationsLayer } from '../../layers/crewedStations/index.js';
import { createAuroraLayer } from '../../layers/aurora/index.js';
import { createSpaceWeatherLayer } from '../../layers/spaceWeather/index.js';
import { createReentriesLayer } from '../../layers/reentries/index.js';
import { overlayHost } from './overlayHost.js';
import * as context from '../../data/contextStore.js';
import { governorRequestRender } from '../../renderGovernor.js';

/**
 * Wire the Lane 1 space and sky layers to the application overlay host,
 * context store and render scheduler. Sources are supplied by the caller.
 * @param {{groups: object, spaceWeather: object, crew: object, reentries: object}} sources
 * @returns {object[]} Layers in panel order.
 */
export function createApplicationSpaceAndSky({
  groups,
  spaceWeather,
  crew,
  reentries,
}) {
  const requestRender = (reason) => governorRequestRender(reason);
  return [
    createSatelliteGroupsLayer({
      source: groups,
      overlayHost,
      context,
      requestRender,
    }),
    createCrewedStationsLayer({
      tleSource: groups,
      crewSource: crew,
      overlayHost,
      requestRender,
    }),
    createReentriesLayer({
      source: reentries,
      tleSource: groups,
      overlayHost,
      requestRender,
    }),
    createAuroraLayer({ source: spaceWeather, requestRender }),
    createSpaceWeatherLayer({ source: spaceWeather }),
  ];
}

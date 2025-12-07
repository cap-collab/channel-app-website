import { Station } from "@/types";

export const STATIONS: Station[] = [
  {
    id: "nts-1",
    name: "NTS 1",
    metadataKey: "nts1",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream",
    websiteUrl: "https://nts.live/1",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#FFFFFF",
  },
  {
    id: "rinse-fm",
    name: "Rinse FM",
    metadataKey: "rinse",
    streamUrl: "https://streamer.radio.co/sb437c8d0f/listen",
    websiteUrl: "https://rinse.fm",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#228EFD",
  },
  {
    id: "subtle",
    name: "Subtle Radio",
    metadataKey: "subtle",
    streamUrl: "https://subtle.airtime.pro/subtle_a",
    websiteUrl: "https://subtleradio.net",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#C3E943",
  },
  {
    id: "nts-2",
    name: "NTS 2",
    metadataKey: "nts2",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
    websiteUrl: "https://nts.live/2",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#FFFFFF",
  },
  {
    id: "rinse-fr",
    name: "Rinse FR",
    metadataKey: "rinsefr",
    streamUrl: "https://stream.rfrfr.fm/rinsefr",
    websiteUrl: "https://rfrfr.fm",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#8A8A8A",
  },
  {
    id: "dublab",
    name: "dublab",
    metadataKey: "dublab",
    streamUrl: "https://dublab.airtime.pro/dublab_a",
    websiteUrl: "https://dublab.com",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#0287FE",
  },
];

export function getStationById(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id);
}

export function getStationByMetadataKey(key: string): Station | undefined {
  return STATIONS.find((s) => s.metadataKey === key);
}

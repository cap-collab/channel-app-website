import { Station } from "@/types";

export const STATIONS: Station[] = [
  {
    id: "broadcast",
    name: "Channel Broadcast",
    metadataKey: "broadcast",
    streamUrl: "",
    websiteUrl: "https://channel-app.com/channel",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#D94099",
  },
  {
    id: "nts-1",
    name: "NTS 1",
    metadataKey: "nts1",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream",
    websiteUrl: "https://www.nts.live/",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#FFFFFF",
  },
  {
    id: "rinse-fm",
    name: "Rinse FM",
    metadataKey: "rinse",
    streamUrl: "https://admin.stream.rinse.fm/proxy/rinse_uk/stream",
    websiteUrl: "https://www.rinse.fm/",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#228EFD",
  },
  {
    id: "subtle",
    name: "Subtle Radio",
    metadataKey: "subtle",
    streamUrl: "https://subtle.out.airtime.pro/subtle_a",
    websiteUrl: "https://www.subtleradio.com/",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#C3E943",
  },
  {
    id: "nts-2",
    name: "NTS 2",
    metadataKey: "nts2",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
    websiteUrl: "https://www.nts.live/",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#FFFFFF",
  },
  {
    id: "rinse-fr",
    name: "Rinse FR",
    metadataKey: "rinsefr",
    streamUrl: "https://radio10.pro-fhi.net/flux-trmqtiat/stream",
    websiteUrl: "https://www.rinse.fm/channels/france",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#8A8A8A",
  },
  {
    id: "dublab",
    name: "dublab",
    metadataKey: "dublab",
    streamUrl: "https://dublab.out.airtime.pro/dublab_a",
    websiteUrl: "https://www.dublab.com/",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#0287FE",
  },
  {
    id: "newtown",
    name: "Newtown Radio",
    metadataKey: "newtown",
    streamUrl: "https://streaming.radio.co/s0d090ee43/listen",
    websiteUrl: "https://newtownradio.com",
    backgroundColor: "#1A1A1A",
    textColor: "#FEFEFE",
    accentColor: "#ec92af",
  },
  {
    id: "dj-radio",
    name: "Radio",
    metadataKey: "dj-radio",
    streamUrl: "",
    websiteUrl: "",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
    accentColor: "#D94099",
  },
];

export function getStationById(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id);
}

export function getStationByMetadataKey(key: string): Station | undefined {
  return STATIONS.find((s) => s.metadataKey === key);
}

export function getMetadataKeyByStationId(stationId: string): string | undefined {
  return STATIONS.find((s) => s.id === stationId)?.metadataKey;
}

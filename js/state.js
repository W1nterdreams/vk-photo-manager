export const state = {
    currentUser: null,
    accessToken: null,

    group: null,

    albums: [],
    albumsTotal: 0,
    albumsOffset: 0,
    albumsHasMore: false,
    albumsLoadingMore: false,

    albumIndex: [],
    albumIndexReady: false,
    albumIndexBuilding: false,
    currentAlbum: null,
    photos: [],
    photosTotal: 0,
    photosOffset: 0,
    photosHasMore: false,
    photosLoadingMore: false,

    albumSearchText: "",
    currentScreen: "albums"
};

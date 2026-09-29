export const state = {
    config: null,
    launchParams: null,
    currentUser: null,
    accessToken: null,
    groupId: 0,
    ownerId: 0,
    contextType: "",
    restrictAlbums: false,

    albums: [],
    albumsFetchedAt: 0,
    albumSearchText: "",

    currentAlbum: null,
    photos: [],
    photoSearchText: "",
    photoSortMode: "vk",
    photosFreshAtByAlbum: new Map(),
    sessionPhotosByAlbum: new Map(),

    currentPhoto: null,
    photoViewerSource: "",
    viewerSequence: [],

    globalQuery: "",
    globalMatchesSource: [],
    globalMatches: [],
    globalRenderedCount: 0,
    globalScrollTop: 0,

    currentScreen: "albums",
    suppressPhotoOpenUntil: 0
};

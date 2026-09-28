const id = name => document.getElementById(name);

export const dom = {
    app: id("app"),
    user: id("user"),
    pageTitle: id("pageTitle"),
    backButton: id("backButton"),
    refreshButton: id("refreshButton"),

    albumSortControls: id("albumSortControls"),
    sortNewestButton: id("sortNewestButton"),
    sortOldestButton: id("sortOldestButton"),
    sortCurrentButton: id("sortCurrentButton"),

    albumsScreen: id("albumsScreen"),
    photosScreen: id("photosScreen"),
    photoViewerScreen: id("photoViewerScreen"),

    albumSearch: id("albumSearch"),
    clearAlbumSearch: id("clearAlbumSearch"),
    albums: id("albums"),

    albumTitle: id("albumTitle"),
    albumDescription: id("albumDescription"),
    photoCount: id("photoCount"),
    photoSearch: id("photoSearch"),
    clearPhotoSearch: id("clearPhotoSearch"),
    photos: id("photos"),

    globalPhotoSearch: id("globalPhotoSearch"),
    clearGlobalPhotoSearch: id("clearGlobalPhotoSearch"),
    globalSearchStatus: id("globalSearchStatus"),
    globalSearchResults: id("globalSearchResults"),

    photoViewerImage: id("photoViewerImage"),
    photoViewerPrev: id("photoViewerPrev"),
    photoViewerNext: id("photoViewerNext"),
    photoViewerDescription: id("photoViewerDescription"),
    photoViewerFreshness: id("photoViewerFreshness"),
    photoViewerLikes: id("photoViewerLikes"),
    photoViewerReposts: id("photoViewerReposts"),
    openPhotoCommentsButton: id("openPhotoCommentsButton")
};

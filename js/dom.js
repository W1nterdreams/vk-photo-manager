const id = name => document.getElementById(name);
export const dom = {
 user:id("user"), pageTitle:id("pageTitle"), albumsScreen:id("albumsScreen"), photosScreen:id("photosScreen"), commentsScreen:id("commentsScreen"), photoViewerScreen:id("photoViewerScreen"),
 albums:id("albums"), photos:id("photos"), comments:id("comments"), albumTitle:id("albumTitle"), albumDescription:id("albumDescription"), photoCount:id("photoCount"),
 photoViewerImage:id("photoViewerImage"), photoViewerDescription:id("photoViewerDescription"), photoViewerLikes:id("photoViewerLikes"), photoViewerReposts:id("photoViewerReposts"), photoViewerComments:id("photoViewerComments"),
 photoViewerReplyTarget:id("photoViewerReplyTarget"), photoViewerReplyCancel:id("photoViewerReplyCancel"), photoViewerCommentInput:id("photoViewerCommentInput"), photoViewerCommentError:id("photoViewerCommentError"), photoViewerCommentSubmit:id("photoViewerCommentSubmit"),
 refreshAlbums:id("refreshAlbums"), refreshComments:id("refreshComments"), backButton:id("backButton"), albumSearch:id("albumSearch"), clearSearch:id("clearSearch"),
 menuButton:id("menuButton"), mainMenu:id("mainMenu"), menuContainer:document.querySelector(".menu-container"), createAlbumMenuButton:id("createAlbumMenuButton"), commentsMenuButton:id("commentsMenuButton"), uploadPhotoMenuButton:id("uploadPhotoMenuButton"),
 createAlbumModal:id("createAlbumModal"), createAlbumForm:id("createAlbumForm"), newAlbumTitle:id("newAlbumTitle"), newAlbumDescription:id("newAlbumDescription"), createAlbumError:id("createAlbumError"),
 submitCreateAlbum:id("submitCreateAlbum"), closeCreateAlbum:id("closeCreateAlbum"), cancelCreateAlbum:id("cancelCreateAlbum"),
 editAlbumModal:id("editAlbumModal"), editAlbumForm:id("editAlbumForm"), editAlbumTitle:id("editAlbumTitle"), editAlbumDescription:id("editAlbumDescription"),
 editAlbumAllowComments:id("editAlbumAllowComments"), editAlbumAllowUploads:id("editAlbumAllowUploads"), editAlbumError:id("editAlbumError"),
 saveEditAlbum:id("saveEditAlbum"), closeEditAlbum:id("closeEditAlbum"), cancelEditAlbum:id("cancelEditAlbum"),
 uploadPhotoModal:id("uploadPhotoModal"), uploadPhotoAlbumName:id("uploadPhotoAlbumName"), uploadPhotoFiles:id("uploadPhotoFiles"), uploadPhotoSelection:id("uploadPhotoSelection"), uploadPhotoCaption:id("uploadPhotoCaption"), uploadPhotoProgress:id("uploadPhotoProgress"), uploadPhotoError:id("uploadPhotoError"), submitUploadPhoto:id("submitUploadPhoto"), closeUploadPhoto:id("closeUploadPhoto"), cancelUploadPhoto:id("cancelUploadPhoto")
};

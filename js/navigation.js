import {state} from "./state.js"; import {dom} from "./dom.js";
function hide(){dom.albumsScreen.classList.add("hidden");dom.photosScreen.classList.add("hidden");dom.commentsScreen.classList.add("hidden");}
export function showAlbumsScreen(){hide();dom.albumsScreen.classList.remove("hidden");state.currentScreen="albums";state.currentAlbum=null;dom.pageTitle.textContent="Фотоальбомы";dom.backButton.classList.add("hidden");dom.refreshAlbums.classList.remove("hidden");window.scrollTo(0,0);}
export function showPhotosScreen(){hide();dom.photosScreen.classList.remove("hidden");state.currentScreen="photos";dom.backButton.classList.remove("hidden");dom.refreshAlbums.classList.add("hidden");window.scrollTo(0,0);}
export function showCommentsScreen(){hide();dom.commentsScreen.classList.remove("hidden");state.currentScreen="comments";dom.pageTitle.textContent="Комментарии";dom.backButton.classList.remove("hidden");dom.refreshAlbums.classList.add("hidden");window.scrollTo(0,0);}
export function initNavigation(){dom.backButton.addEventListener("click",showAlbumsScreen);}

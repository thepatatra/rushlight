<p align="center"><img src="assets/logo-512.png" width="128" alt="Logo Rushlight"></p>

# Rushlight

[English](README.md) · **Français**

Une extension pour Premiere Pro qui enlève les silences de mes rushs et me montre où sont les bons passages.

https://github.com/user-attachments/assets/a47fbd04-cd38-44be-bad5-1fefa6bcffaf

Je l'ai commencée parce que je passais trop de temps à dérusher mes sessions de jeu. Trois ou quatre heures
d'enregistrement, avec des menus, des temps morts, des moments où je ne dis rien... Couper tout ça à la main,
c'est long et pénible. Rushlight écoute le son de la séquence, coupe les blancs, recolle la timeline et
place des marqueurs sur les passages les plus animés pour que je les retrouve vite.

Le projet évolue encore régulièrement : les corrections et les nouveautés arrivent au fil des versions.
L'historique est dans [CHANGELOG.md](CHANGELOG.md).

## Ce qu'elle fait

Le cœur de l'extension, c'est la suppression des silences : elle analyse toutes les pistes audio de la séquence,
calcule elle-même le bon seuil à partir de la moyenne du son, puis coupe et resserre la timeline. Il y a quelques
modes tout prêts selon le type de vidéo (gaming, vlog, podcast, best of), et on peut aussi lui demander de retirer
les passages calmes, pas seulement les vrais blancs.

Pour les longues séquences, on peut couper heure par heure. Chaque heure déjà traitée est marquée en vert et
l'extension n'y retouche plus.

Elle sait aussi repérer les moments forts à partir du son (voix qui monte, débit rapide, exclamations, rires) et
peut fabriquer une séquence "best of" avec seulement ces passages, sans toucher à la séquence d'origine.

Et comme couper des heures de rushs automatiquement peut mal tourner, elle sauvegarde le projet avant chaque
modification et vérifie chaque coupe. Au moindre souci elle s'arrête et indique quelle sauvegarde rouvrir.

Le panneau est en français et en anglais : il suit la langue de Premiere, et on peut la changer dans Réglages.

## D'une longue session à des Shorts, des TikTok et des clips

C'est la partie que j'utilise le plus après avoir coupé les silences. Sur une session de trois heures, retrouver
les cinq moments qui valent le coup d'être postés oblige normalement à tout revoir. Rushlight fait un premier tri :

1. "Trouver de nouveaux moments forts" place un marqueur orange sur les passages les plus intenses (voix qui
   monte, débit rapide, exclamations, rires), numérotés du meilleur au moins bon, avec la raison du choix.
2. Un clic sur un moment de la liste emmène dessus pour le vérifier. S'il ne convient pas, la croix le retire
   définitivement des propositions, et la recherche suivante en propose d'autres.
3. "Créer une séquence best of" met bout à bout tous les moments gardés dans une nouvelle séquence, prête à
   ajuster et à exporter, sans toucher à votre montage d'origine.

Le réglage Durée décide de ce que vous obtenez : des moments courts de 8 secondes pour une accroche ou un récap
nerveux, ou des passages de 20 à 30 secondes qui tiennent seuls en Shorts, TikTok ou Reels. L'extension n'écoute
que le son, donc elle ne comprendra pas une phrase importante dite calmement, mais elle fait l'essentiel des
recherches à votre place.

## Installation

Il faut Windows, Premiere Pro 2021 ou plus récent et ffmpeg, qui sert à analyser le son.

Rushlight est testé sur Premiere Pro 2026 (versions 26.0 et 26.5). Il devrait aussi tourner sur les versions
précédentes : si vous l'essayez sur une autre version, n'hésitez pas à me dire dans une
[issue](https://github.com/thepatatra/rushlight/issues) si tout va bien.

Pour installer ffmpeg, dans PowerShell :

```
winget install Gyan.FFmpeg
```

Ensuite :

1. Téléchargez le fichier `Rushlight-vX.Y.Z.zip` de la dernière version, dans la page
   [Releases](https://github.com/thepatatra/rushlight/releases/latest), et décompressez-le où vous voulez.
2. Fermez Premiere, puis double-cliquez sur `install.bat`.
3. Rouvrez Premiere : le panneau est dans Fenêtre > Extensions > Rushlight.

Pour une mise à jour, c'est pareil : téléchargez la nouvelle version et relancez `install.bat`.

## Comment je l'utilise

Avant de commencer, le projet doit avoir été enregistré au moins une fois. Je verrouille aussi les pistes que je
ne veux pas voir coupées, par exemple une musique de fond.

1. Je choisis un mode en haut du panneau (Gaming pour mes sessions de jeu) et je laisse "Réglage automatique"
   coché.
2. Je clique sur Analyser. Rien n'est modifié à ce stade : le panneau affiche juste le seuil trouvé, le nombre de
   coupes et le temps qui sera retiré.
3. La première fois sur un nouveau type de vidéo, je passe l'action sur "Ajouter des marqueurs seulement" et je
   clique sur Couper. Ça pose un marqueur rouge sur chaque silence, ce qui permet de vérifier que les coupes
   tombent au bon endroit.
4. Si ça me va, je remets l'action sur "Supprimer les silences et resserrer", je choisis la zone (une heure, ou
   toutes celles qui restent) et je coupe.
5. Après une coupe, il faut relancer Analyser avant de couper la suite. Les zones déjà faites sont ignorées.

Pour les moments forts, on règle le nombre de passages voulus et leur durée, puis "Trouver de nouveaux moments
forts". Des marqueurs orange apparaissent, numérotés du meilleur au moins bon, et la liste du panneau reprend les
mêmes numéros (un clic emmène au passage). La liste est relue depuis les marqueurs, donc elle est toujours là après
avoir fermé Premiere.

Si un moment ne vous intéresse pas, la petite croix à côté le passe en "ignoré" (marqueur blanc) : il ne sera plus
jamais proposé. Relancer la recherche donne de nouveaux moments, jamais les mêmes, jusqu'à ce que l'extension
indique qu'il n'y a plus de passage qui se détache vraiment. "Effacer tous les moments forts" permet de repartir
de zéro. Quelques réglages qui marchent bien chez moi :

| Pour faire... | Nombre | Durée |
|---|---|---|
| une accroche en début de vidéo | 3 | 5 s |
| un best of nerveux | 10 | 8 s |
| des Shorts / TikTok | 5 | 20 à 30 s |
| repérer les grosses phases d'action | 8 | 15 s |

## Les réglages

| Réglage | À quoi il sert |
|---|---|
| Mode | Remplit les réglages en dessous. Si on en change un à la main, le mode repasse en "Personnalisé". |
| Réglage automatique | Calcule le seuil de silence sur toute la séquence. Bouger le curseur repasse en manuel, avec un aperçu immédiat. |
| Durée min. du silence | En dessous, un blanc n'est pas coupé. |
| Marge avant / après | Le son gardé autour de chaque passage, pour ne pas couper le début ou la fin des mots. |
| Couper aussi les passages calmes | Retire en plus les moments calmes qui durent au moins le temps indiqué. |
| Supprimer aussi les trous | Referme aussi les vides qui existaient déjà entre les clips. |
| Zone à couper | Une heure précise, ou toutes les zones restantes. |
| Réglages > Langue | Automatique (langue de Premiere), français ou anglais. |

Les valeurs des modes :

| Mode | Silence min. | Marges avant / après | Passages calmes | Moments forts |
|---|---|---|---|---|
| Gaming | 800 ms | 150 / 400 ms | non | 8 × 15 s |
| Vlog / face cam | 350 ms | 80 / 120 ms | non | 5 × 10 s |
| Podcast / interview | 1000 ms | 200 / 300 ms | non | 5 × 20 s |
| Best of | 300 ms | 60 / 100 ms | oui, dès 3 s | 10 × 8 s |

## Sauvegardes

Avant chaque coupe (et avant chaque zone quand on en enchaîne plusieurs), le projet est enregistré puis copié dans
un dossier `Rushlight - sauvegardes` à côté du fichier `.prproj`. Les noms disent quand et pourquoi la copie a été
faite, par exemple `Ma Vidéo_2026-10-27_14-05-12_avant-coupe-zone-1-sur-4.prproj`. Rien n'est jamais écrasé.

Pour revenir en arrière, il suffit d'ouvrir la sauvegarde voulue avec Fichier > Ouvrir le projet, puis de faire
"Enregistrer sous" à côté du projet habituel.

## À savoir

- Les marqueurs verts protègent les zones déjà coupées. Pour recouper une zone, il faut supprimer son marqueur.
  Si une séquence a été coupée à la main, on peut la protéger avec "Marquer comme déjà coupé" (sur les points
  d'entrée/sortie, ou sur toute la séquence).
- Les pistes verrouillées ne sont jamais coupées ni déplacées.
- Après la coupe, l'image et le son de chaque morceau sont reliés à nouveau. Sur une séquence coupée autrement,
  le bouton "Relier son et vidéo" fait la même chose.
- Les moments forts sont devinés uniquement à partir du son. L'extension ne comprend pas ce qui est dit, donc une
  phrase importante dite calmement ne ressortira pas.
- Si un message commençant par ⚠ apparaît, l'extension s'est arrêtée par sécurité : il suffit de rouvrir la
  sauvegarde indiquée.

## Si ça ne marche pas

- Le panneau n'apparaît pas : relancer `install.bat`, Premiere fermé.
- "ffmpeg introuvable" : installer ffmpeg (voir plus haut) ou indiquer son chemin dans Réglages.
- "Enregistrez d'abord le projet" : faire Fichier > Enregistrer une première fois.
- Coupes trop serrées ou trop larges : essayer un autre mode, ou jouer sur les marges et la durée minimale.

Un bug ou une idée ? Ouvrez une [issue](https://github.com/thepatatra/rushlight/issues). Pour modifier le code,
les notes techniques sont dans [Rushlight/README.md](Rushlight/README.md).

## Comment il a été fait

Un projet perso, codé avec l'aide d'une IA (Claude) et pensé, testé et ajusté sur mes propres vidéos.

## Avant de l'utiliser

Rushlight est un projet perso que je partage gratuitement, tel quel. Je l'utilise sur mes propres vidéos et j'ai
mis pas mal de garde-fous (sauvegardes automatiques, vérification de chaque coupe), mais je ne peux pas garantir
qu'il fonctionnera parfaitement sur toutes les configurations. Gardez toujours une copie de vos projets importants
et vérifiez le résultat avant de publier une vidéo. Je ne pourrai pas être tenu responsable d'un projet abîmé ou
d'un travail perdu.

C'est un projet indépendant, sans lien avec Adobe. Premiere Pro est une marque d'Adobe.

Le code est sous licence MIT (voir [LICENSE](LICENSE)) : vous pouvez l'utiliser, le modifier et le partager
librement, en gardant la mention de licence.

## Soutenir le projet

Rushlight est et restera gratuit. Si elle vous fait gagner du temps sur vos montages, vous pouvez m'offrir une
pizza sur Ko-fi, ça m'aide à continuer à l'améliorer.

[![Soutenir sur Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/rushlight)

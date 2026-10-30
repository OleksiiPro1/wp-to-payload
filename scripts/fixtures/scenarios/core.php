<?php
/**
 * Title: Bäckerei Beispiel
 *
 * WordPress without plugins: blocks and classic content, media with generated sizes, a category
 * tree with term meta, tags, two authors, every post status, an earlier slug, a page tree, a
 * reusable block, comments, two menus with a submenu, and a custom post type with its own
 * taxonomy (registered by mu-plugins/wp2p-fixture-types.php). All content is made up.
 */

require __DIR__ . '/../lib/fixtures.php';

update_option( 'blogdescription', 'Brot und Gebäck aus einer erfundenen Backstube' );

$anna = fx_user( 'anna', 'Anna Beispiel' );
$ben  = fx_user( 'ben', 'Ben Muster', 'editor' );

// Terms.
$general = fx_term( 'Allgemein', 'category', array( 'slug' => 'allgemein' ) );
update_option( 'default_category', $general );
$recipes = fx_term(
	'Rezepte & Backen',
	'category',
	array(
		'slug'        => 'rezepte',
		'description' => 'Alles, was wir backen',
	),
	array(
		'color'    => '#c08040',
		'featured' => '1',
	)
);
$bread     = fx_term( 'Brot', 'category', array( 'slug' => 'brot', 'parent_slug' => 'rezepte' ) );
$news      = fx_term( 'Neuigkeiten', 'category', array( 'slug' => 'neuigkeiten' ) );
$sourdough = fx_term( 'Sauerteig', 'post_tag', array( 'slug' => 'sauerteig' ) );
$tips      = fx_term( 'Tipps', 'post_tag', array( 'slug' => 'tipps' ), array( 'icon' => 'lightbulb' ) );

// Pages, the targets of links further down.
$about = fx_post(
	array(
		'post_type'    => 'page',
		'post_title'   => 'Über uns',
		'post_name'    => 'ueber-uns',
		'menu_order'   => 1,
		'post_date'    => '2024-01-02 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Wir sind eine erfundene Bäckerei in Wien.</p>\n<!-- /wp:paragraph -->",
	)
);
update_post_meta( $about, '_wp_page_template', 'default' );
$contact = fx_post(
	array(
		'post_type'    => 'page',
		'post_title'   => 'Kontakt',
		'post_name'    => 'kontakt',
		'menu_order'   => 2,
		'post_date'    => '2024-01-02 10:05:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Schreib uns an hallo@example.com.</p>\n<!-- /wp:paragraph -->",
	)
);

// Media: a large image (WordPress adds a "-scaled" copy), and two smaller ones.
$workshop = fx_image(
	'backstube.png',
	array( 200, 120, 40 ),
	2600,
	1600,
	array(
		'date'    => '2024-01-15 09:00:00',
		'alt'     => 'Die Backstube am Morgen',
		'caption' => 'Morgenlicht in der Backstube',
	)
);
$loaf      = fx_image( 'brot.png', array( 150, 90, 30 ), 1200, 800, array( 'date' => '2024-01-15 09:05:00', 'alt' => 'Ein frisches Brot' ) );
$croissant = fx_image( 'croissant.png', array( 230, 180, 60 ), 800, 800, array( 'date' => '2024-02-01 07:00:00', 'alt' => 'Croissant' ) );

$team = fx_post(
	array(
		'post_type'    => 'page',
		'post_title'   => 'Team',
		'post_name'    => 'team',
		'post_parent'  => $about,
		'post_author'  => $ben,
		'post_date'    => '2024-01-03 10:00:00',
		'post_content' => sprintf(
			"<!-- wp:paragraph -->\n<p>Anna backt, Ben verkauft.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:image {\"id\":%d,\"sizeSlug\":\"large\"} -->\n<figure class=\"wp-block-image size-large\"><img src=\"%s\" alt=\"\" class=\"wp-image-%d\"/></figure>\n<!-- /wp:image -->",
			$workshop,
			wp_get_attachment_image_url( $workshop, 'large' ),
			$workshop
		),
	)
);

// A reusable block (synced pattern).
$hours = fx_post(
	array(
		'post_type'    => 'wp_block',
		'post_title'   => 'Öffnungszeiten',
		'post_date'    => '2024-01-05 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Montag bis Samstag, 6 bis 18 Uhr.</p>\n<!-- /wp:paragraph -->",
	)
);

// A classic-editor post with a caption, a plugin shortcode and line breaks.
$opening = fx_post(
	array(
		'post_title'    => 'Neue Öffnungszeiten',
		'post_name'     => 'neue-oeffnungszeiten',
		'post_author'   => $ben,
		'post_date'     => '2024-02-01 09:00:00',
		'post_category' => array( $news ),
		'post_content'  => 'Platzhalter',
	)
);
wp_set_post_terms( $opening, array( $tips ), 'post_tag' );
wp_update_post(
	array(
		'ID'           => $opening,
		'post_content' => sprintf(
			"Wir öffnen ab März <strong>früher</strong>.\n\n[caption id=\"attachment_%d\" align=\"aligncenter\" width=\"300\"]<img class=\"size-medium wp-image-%d\" src=\"%s\" alt=\"Croissant\" width=\"300\" height=\"300\" /> Jeden Morgen frische Croissants[/caption]\n\nZum Bestellen nutze unser [contact-form-7 id=\"5\" title=\"Bestellung\"] Formular.\n\nErste Zeile\nzweite Zeile",
			$croissant,
			$croissant,
			wp_get_attachment_image_url( $croissant, 'medium' )
		),
	)
);
fx_fix_modified( $opening, '2024-02-01 09:00:00' );

// The main block post. Its first slug is changed later, so WordPress keeps it as _wp_old_slug.
$hello = fx_post(
	array(
		'post_title'    => 'Hallo Sauerteig',
		'post_name'     => 'erster-beitrag',
		'post_author'   => $anna,
		'post_date'     => '2024-01-15 10:30:00',
		'post_category' => array( $recipes, $bread ),
		'post_excerpt'  => 'Unser erster Beitrag über Sauerteig.',
		'post_content'  => 'Platzhalter',
	)
);
wp_set_post_terms( $hello, array( $sourdough ), 'post_tag' );
$content = <<<HTML
<!-- wp:paragraph -->
<p>Willkommen in unserer <strong>Backstube</strong>. Lies die <a href="%OPENING%">neuen Öffnungszeiten</a> oder mehr <a href="%ABOUT%">über uns</a>.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Zutaten</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Mehl</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Wasser und Salz</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:image {"id":%LOAF%,"sizeSlug":"medium","linkDestination":"none"} -->
<figure class="wp-block-image size-medium"><img src="%LOAF_MEDIUM%" alt="Ein frisches Brot" class="wp-image-%LOAF%"/><figcaption class="wp-element-caption">Unser erstes Brot</figcaption></figure>
<!-- /wp:image -->

<!-- wp:quote -->
<blockquote class="wp-block-quote"><!-- wp:paragraph -->
<p>Brot ist Geduld, die man essen kann.</p>
<!-- /wp:paragraph --><cite>Eine erfundene Bäckerin</cite></blockquote>
<!-- /wp:quote -->

<!-- wp:code -->
<pre class="wp-block-code"><code>hydration = wasser / mehl</code></pre>
<!-- /wp:code -->

<!-- wp:table -->
<figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>Zutat</th><th>Gramm</th></tr></thead><tbody><tr><td>Mehl</td><td>500</td></tr><tr><td>Wasser</td><td>350</td></tr></tbody></table></figure>
<!-- /wp:table -->

<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="%CONTACT%">Jetzt bestellen</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->

<!-- wp:embed {"url":"https://www.youtube.com/watch?v=abc123XYZ00","type":"video","providerNameSlug":"youtube","responsive":true} -->
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">
https://www.youtube.com/watch?v=abc123XYZ00
</div></figure>
<!-- /wp:embed -->

<!-- wp:gallery {"linkTo":"none"} -->
<figure class="wp-block-gallery has-nested-images columns-default is-cropped"><!-- wp:image {"id":%LOAF%,"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="%LOAF_LARGE%" alt="" class="wp-image-%LOAF%"/></figure>
<!-- /wp:image -->

<!-- wp:image {"id":%CROISSANT%,"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="%CROISSANT_FULL%" alt="Croissant" class="wp-image-%CROISSANT%"/></figure>
<!-- /wp:image --></figure>
<!-- /wp:gallery -->

<!-- wp:columns -->
<div class="wp-block-columns"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:paragraph -->
<p>Linke Spalte.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:paragraph -->
<p>Gruppe in der rechten Spalte.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->

<!-- wp:block {"ref":%HOURS%} /-->

<!-- wp:latest-posts {"postsToShow":3} /-->
HTML;
$content = strtr(
	$content,
	array(
		'%OPENING%'        => get_permalink( $opening ),
		'%ABOUT%'          => get_permalink( $about ),
		'%CONTACT%'        => get_permalink( $contact ),
		'%LOAF%'           => (string) $loaf,
		'%LOAF_MEDIUM%'    => wp_get_attachment_image_url( $loaf, 'medium' ),
		'%LOAF_LARGE%'     => wp_get_attachment_image_url( $loaf, 'large' ),
		'%CROISSANT%'      => (string) $croissant,
		'%CROISSANT_FULL%' => wp_get_attachment_image_url( $croissant, 'full' ),
		'%HOURS%'          => (string) $hours,
	)
);
wp_update_post(
	array(
		'ID'           => $hello,
		'post_name'    => 'hallo-sauerteig',
		'post_content' => $content,
	)
);
fx_fix_modified( $hello, '2024-03-01 12:00:00' );
set_post_thumbnail( $hello, $workshop );
stick_post( $hello );
fx_comment( $hello, 'Eine Leserin', 'Sieht köstlich aus!', '2024-01-16 08:00:00' );
fx_comment( $hello, 'Ein Leser', 'Danke für das Rezept.', '2024-01-17 09:30:00' );
fx_comment( $opening, 'Stammkunde', 'Endlich früher!', '2024-02-02 07:15:00' );

// Every other status.
fx_post(
	array(
		'post_title'    => 'Bald: Roggenbrot',
		'post_status'   => 'draft',
		'post_name'     => '',
		'post_date'     => '2024-04-01 12:00:00',
		'post_category' => array( $recipes ),
		'post_content'  => "<!-- wp:paragraph -->\n<p>Kommt bald.</p>\n<!-- /wp:paragraph -->",
	)
);
fx_post(
	array(
		'post_title'   => 'Weihnachtsstollen',
		'post_status'  => 'future',
		'post_name'    => 'weihnachtsstollen',
		'post_date'    => '2030-12-01 08:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Ab Dezember.</p>\n<!-- /wp:paragraph -->",
	)
);
fx_post(
	array(
		'post_title'   => 'Interne Notiz',
		'post_status'  => 'private',
		'post_name'    => 'interne-notiz',
		'post_date'    => '2024-02-10 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Nur für uns.</p>\n<!-- /wp:paragraph -->",
	)
);
fx_post(
	array(
		'post_title'    => 'Geheimrezept',
		'post_name'     => 'geheimrezept',
		'post_password' => 'fixture-only',
		'post_date'     => '2024-02-11 10:00:00',
		'post_content'  => "<!-- wp:paragraph -->\n<p>Nur mit Passwort.</p>\n<!-- /wp:paragraph -->",
	)
);
fx_post(
	array(
		'post_title'   => 'Wartet auf Freigabe',
		'post_status'  => 'pending',
		'post_name'    => 'wartet-auf-freigabe',
		'post_author'  => $anna,
		'post_date'    => '2024-02-12 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Bitte prüfen.</p>\n<!-- /wp:paragraph -->",
	)
);
$trashed = fx_post(
	array(
		'post_title'   => 'Gelöschter Beitrag',
		'post_name'    => 'geloeschter-beitrag',
		'post_date'    => '2024-01-10 10:00:00',
		'post_content' => '<p>Weg.</p>',
	)
);
wp_trash_post( $trashed );
fx_fix_modified( $trashed, '2024-01-10 10:00:00' );
update_post_meta( $trashed, '_wp_trash_meta_time', 1704877200 );

// Custom post type with its own taxonomy and a plain custom field.
$recipe_bread = fx_term( 'Brot', 'recipe_category', array( 'slug' => 'brot' ) );
$recipe_sweet = fx_term( 'Süßes', 'recipe_category', array( 'slug' => 'suesses' ) );
$rye          = fx_post(
	array(
		'post_type'    => 'recipe',
		'post_title'   => 'Roggenbrot',
		'post_name'    => 'roggenbrot',
		'post_author'  => $anna,
		'post_date'    => '2024-03-01 08:00:00',
		'post_excerpt' => 'Kräftig und saftig.',
		'post_content' => "<!-- wp:paragraph -->\n<p>Ein Rezept für dunkles Roggenbrot.</p>\n<!-- /wp:paragraph -->",
	)
);
wp_set_object_terms( $rye, array( $recipe_bread ), 'recipe_category' );
set_post_thumbnail( $rye, $loaf );
update_post_meta( $rye, 'baking_time', '45' );
$rolls = fx_post(
	array(
		'post_type'    => 'recipe',
		'post_title'   => 'Zimtschnecken',
		'post_name'    => 'zimtschnecken',
		'post_date'    => '2024-03-05 08:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Süß und klebrig.</p>\n<!-- /wp:paragraph -->",
	)
);
wp_set_object_terms( $rolls, array( $recipe_sweet ), 'recipe_category' );

// Menus. Which menu is the header is a theme setting and not part of the export.
$main     = wp_create_nav_menu( 'Hauptmenü' );
$about_mi = fx_menu_item(
	$main,
	array(
		'menu-item-object'    => 'page',
		'menu-item-object-id' => $about,
		'menu-item-type'      => 'post_type',
		'menu-item-position'  => 1,
	)
);
fx_menu_item(
	$main,
	array(
		'menu-item-object'    => 'page',
		'menu-item-object-id' => $team,
		'menu-item-type'      => 'post_type',
		'menu-item-parent-id' => $about_mi,
		'menu-item-position'  => 2,
	)
);
fx_menu_item(
	$main,
	array(
		'menu-item-title'     => 'Rezepte',
		'menu-item-object'    => 'category',
		'menu-item-object-id' => $recipes,
		'menu-item-type'      => 'taxonomy',
		'menu-item-position'  => 3,
	)
);
fx_menu_item(
	$main,
	array(
		'menu-item-title'     => 'Sauerteig',
		'menu-item-object'    => 'post',
		'menu-item-object-id' => $hello,
		'menu-item-type'      => 'post_type',
		'menu-item-position'  => 4,
	)
);
fx_menu_item(
	$main,
	array(
		'menu-item-title'    => 'Onlineshop',
		'menu-item-url'      => 'https://shop.example.org/',
		'menu-item-type'     => 'custom',
		'menu-item-target'   => '_blank',
		'menu-item-position' => 5,
	)
);
$footer = wp_create_nav_menu( 'Footer' );
fx_menu_item(
	$footer,
	array(
		'menu-item-object'    => 'page',
		'menu-item-object-id' => $contact,
		'menu-item-type'      => 'post_type',
		'menu-item-position'  => 1,
	)
);
fx_menu_item(
	$footer,
	array(
		'menu-item-title'    => 'Impressum',
		'menu-item-url'      => '/impressum/',
		'menu-item-type'     => 'custom',
		'menu-item-position' => 2,
	)
);
set_theme_mod(
	'nav_menu_locations',
	array(
		'primary' => $main,
		'footer'  => $footer,
	)
);

WP_CLI::success( 'core scenario created' );

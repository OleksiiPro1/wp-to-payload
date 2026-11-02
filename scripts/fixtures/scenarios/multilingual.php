<?php
/**
 * Title: Tischlerei Beispiel
 * Plugins: polylang@3.9.1
 *
 * A German and English site with Polylang. German is the default language and has no URL prefix;
 * English pages live under /en/. Pages, posts, categories, tags and images are translated; some
 * items exist in one language only, one translation is still a draft, and an English post has
 * an earlier slug. Each language has its own menu. All content is made up.
 */

require __DIR__ . '/../lib/fixtures.php';

update_option( 'blogdescription', 'Möbel aus einer erfundenen Werkstatt' );

$pll                       = PLL();
$pll->options['force_lang']    = 1; // The language is the first directory of the URL.
$pll->options['hide_default']  = true; // No directory for the default language.
$pll->options['rewrite']       = true; // /en/ rather than /language/en/.
$pll->options['media_support'] = true; // Images get a language and translations, too.

foreach (
	array(
		array( 'de_DE', 'de', 'Deutsch', 'de', 0 ),
		array( 'en_US', 'en', 'English', 'us', 1 ),
	) as list( $locale, $slug, $name, $flag, $order )
) {
	$language = $pll->model->languages->add(
		array(
			'locale'     => $locale,
			'slug'       => $slug,
			'name'       => $name,
			'flag'       => $flag,
			'term_group' => $order,
		)
	);
	if ( is_wp_error( $language ) ) {
		fx_fail( $language->get_error_message() );
	}
}
$pll->options['default_lang'] = 'de';

/** Sets the language of a post and returns its ID. */
function ml_post( string $lang, array $args ): int {
	$id = fx_post( $args );
	pll_set_post_language( $id, $lang );
	return $id;
}

/** Sets the language of a term and returns its ID. */
function ml_term( string $lang, string $name, string $taxonomy, array $args = array() ): int {
	$id = fx_term( $name, $taxonomy, $args );
	pll_set_term_language( $id, $lang );
	return $id;
}

$anna = fx_user( 'anna', 'Anna Beispiel' );

// Terms. Polylang keeps a separate term per language and links them as translations.
$products_de = ml_term( 'de', 'Produkte', 'category', array( 'slug' => 'produkte' ) );
$products_en = ml_term( 'en', 'Products', 'category', array( 'slug' => 'products' ) );
pll_save_term_translations( array( 'de' => $products_de, 'en' => $products_en ) );
$furniture_de = ml_term(
	'de',
	'Möbel',
	'category',
	array(
		'slug'        => 'moebel',
		'parent_slug' => 'produkte',
		'description' => 'Tische, Stühle und Regale',
	)
);
$furniture_en = ml_term(
	'en',
	'Furniture',
	'category',
	array(
		'slug'        => 'furniture',
		'parent_slug' => 'products',
		'description' => 'Tables, chairs and shelves',
	)
);
pll_save_term_translations( array( 'de' => $furniture_de, 'en' => $furniture_en ) );
$news_de = ml_term( 'de', 'Neuigkeiten', 'category', array( 'slug' => 'neuigkeiten' ) );
$news_en = ml_term( 'en', 'News', 'category', array( 'slug' => 'news' ) );
pll_save_term_translations( array( 'de' => $news_de, 'en' => $news_en ) );
$oak_de = ml_term( 'de', 'Eiche', 'post_tag', array( 'slug' => 'eiche' ) );
$oak_en = ml_term( 'en', 'Oak', 'post_tag', array( 'slug' => 'oak' ) );
pll_save_term_translations( array( 'de' => $oak_de, 'en' => $oak_en ) );
// A tag in one language only.
$craft_de = ml_term( 'de', 'Handwerk', 'post_tag', array( 'slug' => 'handwerk' ) );

// An image and its English translation: the same file with its own alt text.
$workshop_de = fx_image(
	'werkstatt.png',
	array( 150, 110, 70 ),
	1200,
	800,
	array(
		'date' => '2024-02-01 09:00:00',
		'alt'  => 'Unsere Werkstatt',
	)
);
pll_set_post_language( $workshop_de, 'de' );
$workshop_en = $pll->model->post->create_media_translation( $workshop_de, 'en' );
update_post_meta( $workshop_en, '_wp_attachment_image_alt', 'Our workshop' );
fx_fix_dates( $workshop_en, '2024-02-01 09:00:00' );

// Pages: a tree in both languages, and a page in German only.
$about_de = ml_post(
	'de',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Über uns',
		'post_name'    => 'ueber-uns',
		'post_date'    => '2024-01-02 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Seit 1990 bauen wir Möbel aus heimischem Holz.</p>\n<!-- /wp:paragraph -->",
	)
);
$about_en = ml_post(
	'en',
	array(
		'post_type'    => 'page',
		'post_title'   => 'About us',
		'post_name'    => 'about-us',
		'post_date'    => '2024-01-02 10:05:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>We have been building furniture from local wood since 1990.</p>\n<!-- /wp:paragraph -->",
	)
);
pll_save_post_translations( array( 'de' => $about_de, 'en' => $about_en ) );
$team_de = ml_post(
	'de',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Team',
		'post_name'    => 'team',
		'post_parent'  => $about_de,
		'post_date'    => '2024-01-03 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Drei Tischlerinnen und ein Lehrling.</p>\n<!-- /wp:paragraph -->",
	)
);
$team_en = ml_post(
	'en',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Our team',
		'post_name'    => 'our-team',
		'post_parent'  => $about_en,
		'post_date'    => '2024-01-03 10:05:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Three cabinetmakers and an apprentice.</p>\n<!-- /wp:paragraph -->",
	)
);
pll_save_post_translations( array( 'de' => $team_de, 'en' => $team_en ) );
$contact_de = ml_post(
	'de',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Kontakt',
		'post_name'    => 'kontakt',
		'post_date'    => '2024-01-04 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Schreiben Sie uns an hallo@example.com.</p>\n<!-- /wp:paragraph -->",
	)
);
$contact_en = ml_post(
	'en',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Contact',
		'post_name'    => 'contact',
		'post_date'    => '2024-01-04 10:05:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Write to us at hallo@example.com.</p>\n<!-- /wp:paragraph -->",
	)
);
pll_save_post_translations( array( 'de' => $contact_de, 'en' => $contact_en ) );
$imprint_de = ml_post(
	'de',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Impressum',
		'post_name'    => 'impressum',
		'post_date'    => '2024-01-05 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Tischlerei Beispiel, Musterstraße 1, 1010 Wien.</p>\n<!-- /wp:paragraph -->",
	)
);

// Posts. Links point to the page of the same language. Polylang adds the language directory to
// permalinks only once its languages exist when WordPress starts, so in this script the English
// URLs are written out.
$bench_de = ml_post(
	'de',
	array(
		'post_title'    => 'Neue Werkbank',
		'post_name'     => 'neue-werkbank',
		'post_author'   => $anna,
		'post_date'     => '2024-02-01 10:00:00',
		'post_excerpt'  => 'Unsere neue Werkbank aus Eiche.',
		'post_category' => array( $products_de, $furniture_de ),
		'post_content'  => sprintf(
			"<!-- wp:paragraph -->\n<p>Mehr über die Werkstatt erfahren Sie <a href=\"%s\">über uns</a>.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:image {\"id\":%d,\"sizeSlug\":\"large\"} -->\n<figure class=\"wp-block-image size-large\"><img src=\"%s\" alt=\"Unsere Werkstatt\" class=\"wp-image-%d\"/></figure>\n<!-- /wp:image -->",
			get_permalink( $about_de ),
			$workshop_de,
			wp_get_attachment_image_url( $workshop_de, 'large' ),
			$workshop_de
		),
	)
);
wp_set_post_tags( $bench_de, array( 'eiche', 'handwerk' ) );
set_post_thumbnail( $bench_de, $workshop_de );
$bench_en = ml_post(
	'en',
	array(
		'post_title'    => 'New workbench',
		'post_name'     => 'new-bench',
		'post_author'   => $anna,
		'post_date'     => '2024-02-01 10:30:00',
		'post_excerpt'  => 'Our new oak workbench.',
		'post_category' => array( $products_en, $furniture_en ),
		'post_content'  => sprintf(
			"<!-- wp:paragraph -->\n<p>Find out more <a href=\"%s\">about us</a>.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:image {\"id\":%d,\"sizeSlug\":\"large\"} -->\n<figure class=\"wp-block-image size-large\"><img src=\"%s\" alt=\"Our workshop\" class=\"wp-image-%d\"/></figure>\n<!-- /wp:image -->",
			home_url( '/en/' . get_page_uri( $about_en ) . '/' ),
			$workshop_en,
			wp_get_attachment_image_url( $workshop_en, 'large' ),
			$workshop_en
		),
	)
);
wp_set_post_tags( $bench_en, array( 'oak' ) );
set_post_thumbnail( $bench_en, $workshop_en );
pll_save_post_translations( array( 'de' => $bench_de, 'en' => $bench_en ) );
// The English slug was changed after publishing; WordPress remembers the old one.
wp_update_post(
	array(
		'ID'        => $bench_en,
		'post_name' => 'new-workbench',
	)
);
fx_fix_modified( $bench_en, '2024-02-02 08:00:00' );

$open_day_de = ml_post(
	'de',
	array(
		'post_title'    => 'Tag der offenen Tür',
		'post_name'     => 'tag-der-offenen-tuer',
		'post_date'     => '2024-03-01 10:00:00',
		'post_category' => array( $news_de ),
		'post_content'  => "<!-- wp:paragraph -->\n<p>Am Samstag zeigen wir die Werkstatt.</p>\n<!-- /wp:paragraph -->",
	)
);
$english_only = ml_post(
	'en',
	array(
		'post_title'    => 'Visit us in Vienna',
		'post_name'     => 'visit-us-in-vienna',
		'post_date'     => '2024-03-02 10:00:00',
		'post_category' => array( $news_en ),
		'post_content'  => "<!-- wp:paragraph -->\n<p>A post that exists in English only.</p>\n<!-- /wp:paragraph -->",
	)
);
// The German version is still a draft, the English one is published.
$holiday_de = ml_post(
	'de',
	array(
		'post_title'    => 'Betriebsurlaub',
		'post_name'     => 'betriebsurlaub',
		'post_status'   => 'draft',
		'post_date'     => '2024-03-10 10:00:00',
		'post_category' => array( $news_de ),
		'post_content'  => "<!-- wp:paragraph -->\n<p>Im August machen wir Pause.</p>\n<!-- /wp:paragraph -->",
	)
);
$holiday_en = ml_post(
	'en',
	array(
		'post_title'    => 'Summer break',
		'post_name'     => 'summer-break',
		'post_date'     => '2024-03-10 10:30:00',
		'post_category' => array( $news_en ),
		'post_content'  => "<!-- wp:paragraph -->\n<p>We are closed in August.</p>\n<!-- /wp:paragraph -->",
	)
);
pll_save_post_translations( array( 'de' => $holiday_de, 'en' => $holiday_en ) );

// One menu per language, with a submenu.
foreach (
	array(
		array( 'Hauptmenü', $about_de, $team_de, $news_de, $contact_de ),
		array( 'Main menu', $about_en, $team_en, $news_en, $contact_en ),
	) as list( $name, $about, $team, $news, $contact )
) {
	$menu     = wp_create_nav_menu( $name );
	$about_mi = fx_menu_item(
		$menu,
		array(
			'menu-item-object'    => 'page',
			'menu-item-object-id' => $about,
			'menu-item-type'      => 'post_type',
			'menu-item-position'  => 1,
		)
	);
	fx_menu_item(
		$menu,
		array(
			'menu-item-object'    => 'page',
			'menu-item-object-id' => $team,
			'menu-item-type'      => 'post_type',
			'menu-item-parent-id' => $about_mi,
			'menu-item-position'  => 2,
		)
	);
	fx_menu_item(
		$menu,
		array(
			'menu-item-object'    => 'category',
			'menu-item-object-id' => $news,
			'menu-item-type'      => 'taxonomy',
			'menu-item-position'  => 3,
		)
	);
	fx_menu_item(
		$menu,
		array(
			'menu-item-object'    => 'page',
			'menu-item-object-id' => $contact,
			'menu-item-type'      => 'post_type',
			'menu-item-position'  => 4,
		)
	);
}
$footer = wp_create_nav_menu( 'Footer' );
fx_menu_item(
	$footer,
	array(
		'menu-item-object'    => 'page',
		'menu-item-object-id' => $imprint_de,
		'menu-item-type'      => 'post_type',
		'menu-item-position'  => 1,
	)
);

// Polylang names translation groups with uniqid(). Stable names keep the export the same on
// every run; the names mean nothing else.
$group = 0;
foreach ( array( 'term_translations', 'post_translations' ) as $taxonomy ) {
	$terms = get_terms(
		array(
			'taxonomy'   => $taxonomy,
			'hide_empty' => false,
			'orderby'    => 'term_id',
		)
	);
	foreach ( $terms as $term ) {
		$name = sprintf( 'pll_%013x', ++$group );
		wp_update_term(
			$term->term_id,
			$taxonomy,
			array(
				'name' => $name,
				'slug' => $name,
			)
		);
	}
}

WP_CLI::success( 'multilingual scenario created' );

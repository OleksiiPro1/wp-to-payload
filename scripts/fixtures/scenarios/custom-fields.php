<?php
/**
 * Title: Backschule Beispiel
 * Plugins: secure-custom-fields@6.9.7
 *
 * Custom fields made with Secure Custom Fields, the community fork of Advanced Custom Fields. It
 * stores field groups and values exactly as ACF does and includes the field types of ACF PRO
 * (repeater, flexible content, gallery, clone), which ACF itself has only in its paid version.
 * Field groups for recipes, posts and categories use every field type; one more group exists
 * only as local JSON (acf-json/group_local.json), so it is not in the export, but its values
 * are. All content is made up.
 */

require __DIR__ . '/../lib/fixtures.php';

update_option( 'blogdescription', 'Backkurse in einer erfundenen Backschule' );

$anna = fx_user( 'anna', 'Anna Beispiel' );

$bread_cat = fx_term( 'Brot', 'category', array( 'slug' => 'brot' ) );
$cake_cat  = fx_term( 'Kuchen', 'category', array( 'slug' => 'kuchen' ) );

$loaf   = fx_image( 'roggenbrot.png', array( 120, 80, 40 ), 900, 600, array( 'alt' => 'Ein Roggenbrot' ) );
$crumb  = fx_image( 'krume.png', array( 160, 120, 70 ), 600, 600, array( 'alt' => 'Die Krume' ) );
$oven   = fx_image( 'ofen.png', array( 60, 60, 60 ), 600, 400, array( 'alt' => 'Der Ofen' ) );
$pdf    = fx_file( 'rezept.pdf', "%PDF-1.4\n% made-up recipe sheet\n", 'application/pdf', '2024-01-01 09:00:00' );
$about  = fx_post(
	array(
		'post_type'    => 'page',
		'post_title'   => 'Über uns',
		'post_name'    => 'ueber-uns',
		'post_content' => '<p>Wir unterrichten Brotbacken.</p>',
	)
);
$book   = fx_post(
	array(
		'post_title'    => 'Unser Rezeptbuch',
		'post_name'     => 'unser-rezeptbuch',
		'post_author'   => $anna,
		'post_date'     => '2024-02-01 10:00:00',
		'post_category' => array( $bread_cat ),
		'post_content'  => "<!-- wp:paragraph -->\n<p>Alle Rezepte in einem Buch.</p>\n<!-- /wp:paragraph -->",
	)
);

// Field groups as they are created in the admin; the export contains them.
acf_import_field_group(
	array(
		'key'      => 'group_recipe',
		'title'    => 'Rezeptdaten',
		'location' => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'recipe' ) ) ),
		'fields'   => array(
			array( 'key' => 'field_subtitle', 'label' => 'Untertitel', 'name' => 'subtitle', 'type' => 'text' ),
			array( 'key' => 'field_tab_basics', 'label' => 'Grundlagen', 'name' => '', 'type' => 'tab' ),
			array( 'key' => 'field_notes', 'label' => 'Notizen', 'name' => 'notes', 'type' => 'textarea' ),
			array( 'key' => 'field_baking_time', 'label' => 'Backzeit', 'name' => 'baking_time', 'type' => 'number' ),
			array( 'key' => 'field_contact_email', 'label' => 'Kontakt', 'name' => 'contact_email', 'type' => 'email' ),
			array( 'key' => 'field_source_url', 'label' => 'Quelle', 'name' => 'source_url', 'type' => 'url' ),
			array( 'key' => 'field_instructions', 'label' => 'Anleitung', 'name' => 'instructions', 'type' => 'wysiwyg' ),
			array( 'key' => 'field_hero', 'label' => 'Titelbild', 'name' => 'hero', 'type' => 'image', 'return_format' => 'id' ),
			array( 'key' => 'field_recipe_pdf', 'label' => 'Rezept als PDF', 'name' => 'recipe_pdf', 'type' => 'file' ),
			array( 'key' => 'field_photos', 'label' => 'Fotos', 'name' => 'photos', 'type' => 'gallery' ),
			array(
				'key'     => 'field_difficulty',
				'label'   => 'Schwierigkeit',
				'name'    => 'difficulty',
				'type'    => 'select',
				'choices' => array(
					'easy'   => 'Leicht',
					'medium' => 'Mittel',
					'hard'   => 'Schwer',
				),
			),
			array(
				'key'     => 'field_diets',
				'label'   => 'Ernährung',
				'name'    => 'diets',
				'type'    => 'checkbox',
				'choices' => array(
					'vegan'       => 'Vegan',
					'vegetarisch' => 'Vegetarisch',
					'glutenfrei'  => 'Glutenfrei',
				),
			),
			array(
				'key'     => 'field_oven',
				'label'   => 'Ofen',
				'name'    => 'oven',
				'type'    => 'radio',
				'choices' => array(
					'ober_unter' => 'Ober-/Unterhitze',
					'umluft'     => 'Umluft',
				),
			),
			array( 'key' => 'field_seasonal', 'label' => 'Saisonal', 'name' => 'seasonal', 'type' => 'true_false' ),
			array( 'key' => 'field_published_on', 'label' => 'Veröffentlicht am', 'name' => 'published_on', 'type' => 'date_picker' ),
			array( 'key' => 'field_next_course', 'label' => 'Nächster Kurs', 'name' => 'next_course', 'type' => 'date_time_picker' ),
			array( 'key' => 'field_more_info', 'label' => 'Mehr dazu', 'name' => 'more_info', 'type' => 'link' ),
			array( 'key' => 'field_related_post', 'label' => 'Beitrag', 'name' => 'related_post', 'type' => 'post_object', 'post_type' => array( 'post' ) ),
			array( 'key' => 'field_about_page', 'label' => 'Seite', 'name' => 'about_page', 'type' => 'page_link', 'post_type' => array( 'page' ) ),
			array( 'key' => 'field_related_recipes', 'label' => 'Ähnliche Rezepte', 'name' => 'related_recipes', 'type' => 'relationship', 'post_type' => array( 'recipe' ) ),
			array( 'key' => 'field_categories', 'label' => 'Kategorien', 'name' => 'recipe_categories', 'type' => 'taxonomy', 'taxonomy' => 'category', 'field_type' => 'multi_select' ),
			array(
				'key'        => 'field_nutrition',
				'label'      => 'Nährwerte',
				'name'       => 'nutrition',
				'type'       => 'group',
				'sub_fields' => array(
					array( 'key' => 'field_calories', 'label' => 'Kalorien', 'name' => 'calories', 'type' => 'number' ),
					array(
						'key'     => 'field_allergens',
						'label'   => 'Allergene',
						'name'    => 'allergens',
						'type'    => 'checkbox',
						'choices' => array(
							'gluten' => 'Gluten',
							'nuts'   => 'Nüsse',
						),
					),
				),
			),
			array(
				'key'        => 'field_ingredients',
				'label'      => 'Zutaten',
				'name'       => 'ingredients',
				'type'       => 'repeater',
				'sub_fields' => array(
					array( 'key' => 'field_amount', 'label' => 'Menge', 'name' => 'amount', 'type' => 'text' ),
					array( 'key' => 'field_ingredient', 'label' => 'Zutat', 'name' => 'ingredient', 'type' => 'text' ),
				),
			),
			array(
				'key'     => 'field_sections',
				'label'   => 'Abschnitte',
				'name'    => 'sections',
				'type'    => 'flexible_content',
				'layouts' => array(
					'layout_text'  => array(
						'key'        => 'layout_text',
						'name'       => 'text_block',
						'label'      => 'Text',
						'sub_fields' => array(
							array( 'key' => 'field_section_text', 'label' => 'Text', 'name' => 'text', 'type' => 'wysiwyg' ),
						),
					),
					'layout_quote' => array(
						'key'        => 'layout_quote',
						'name'       => 'quote',
						'label'      => 'Zitat',
						'sub_fields' => array(
							array( 'key' => 'field_section_quote', 'label' => 'Zitat', 'name' => 'quote', 'type' => 'textarea' ),
							array( 'key' => 'field_section_author', 'label' => 'Von', 'name' => 'author', 'type' => 'text' ),
						),
					),
				),
			),
			array( 'key' => 'field_short_text', 'label' => 'Kurztext', 'name' => 'excerpt', 'type' => 'textarea' ),
			array( 'key' => 'field_title_clone', 'label' => 'Titel aus Beitragsdaten', 'name' => 'title_clone', 'type' => 'clone', 'clone' => array( 'field_post_subtitle' ), 'display' => 'seamless', 'prefix_name' => 1 ),
			array( 'key' => 'field_location', 'label' => 'Ort', 'name' => 'location', 'type' => 'google_map' ),
			array( 'key' => 'field_chef', 'label' => 'Kursleitung', 'name' => 'chef', 'type' => 'user' ),
			array( 'key' => 'field_hint', 'label' => 'Hinweis', 'name' => '', 'type' => 'message', 'message' => 'Nur für das Team.' ),
			array( 'key' => 'field_secret', 'label' => 'Zugangscode', 'name' => 'secret_code', 'type' => 'password' ),
		),
	)
);
acf_import_field_group(
	array(
		'key'      => 'group_post',
		'title'    => 'Beitragsdaten',
		'location' => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'post' ) ) ),
		'fields'   => array(
			array( 'key' => 'field_post_subtitle', 'label' => 'Untertitel', 'name' => 'subtitle', 'type' => 'text' ),
			array( 'key' => 'field_reading_time', 'label' => 'Lesezeit', 'name' => 'reading_time', 'type' => 'number' ),
		),
	)
);
acf_import_field_group(
	array(
		'key'      => 'group_category',
		'title'    => 'Kategoriedaten',
		'location' => array( array( array( 'param' => 'taxonomy', 'operator' => '==', 'value' => 'category' ) ) ),
		'fields'   => array(
			array( 'key' => 'field_color', 'label' => 'Farbe', 'name' => 'color', 'type' => 'color_picker' ),
			array( 'key' => 'field_cat_icon', 'label' => 'Bild', 'name' => 'icon', 'type' => 'image' ),
		),
	)
);
// A group in code (local JSON), as many themes ship them.
acf_add_local_field_group( json_decode( file_get_contents( __DIR__ . '/../acf-json/group_local.json' ), true ) );
// Fields cached while importing lack what a clone field loads later; a request in the editor
// starts with an empty cache.
acf_get_store( 'fields' )->reset();

// Recipes with values.
$rye = fx_post(
	array(
		'post_type'    => 'recipe',
		'post_title'   => 'Roggenbrot',
		'post_name'    => 'roggenbrot',
		'post_author'  => $anna,
		'post_date'    => '2024-03-01 08:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Ein kräftiges Brot.</p>\n<!-- /wp:paragraph -->",
	)
);
$cake = fx_post(
	array(
		'post_type'    => 'recipe',
		'post_title'   => 'Apfelkuchen',
		'post_name'    => 'apfelkuchen',
		'post_date'    => '2024-03-02 08:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Mit Äpfeln aus dem Garten.</p>\n<!-- /wp:paragraph -->",
	)
);
$values = array(
	'field_subtitle'        => 'Mit Sauerteig',
	'field_notes'           => "Über Nacht gehen lassen.\nMorgens backen.",
	'field_baking_time'     => 55,
	'field_contact_email'   => 'kurse@example.com',
	'field_source_url'      => 'https://example.org/roggen',
	'field_instructions'    => sprintf( '<p>Den Teig kneten. Mehr dazu in <a href="%s">unserem Buch</a>.</p><p><img class="wp-image-%d" src="%s" alt="Die Krume" /></p>', get_permalink( $book ), $crumb, wp_get_attachment_image_url( $crumb, 'full' ) ),
	'field_hero'            => $loaf,
	'field_recipe_pdf'      => $pdf,
	'field_photos'          => array( $crumb, $oven ),
	'field_difficulty'      => 'medium',
	'field_diets'           => array( 'vegan', 'vegetarisch' ),
	'field_oven'            => 'umluft',
	'field_seasonal'        => true,
	'field_published_on'    => '20240301',
	'field_next_course'     => '2024-05-01 18:00:00',
	'field_more_info'       => array(
		'title'  => 'Roggen im Lexikon',
		'url'    => 'https://example.org/lexikon/roggen',
		'target' => '_blank',
	),
	'field_related_post'    => $book,
	'field_about_page'      => $about,
	'field_related_recipes' => array( $cake ),
	'field_categories'      => array( $bread_cat ),
	'field_nutrition'       => array(
		'calories'  => 240,
		'allergens' => array( 'gluten' ),
	),
	'field_ingredients'     => array(
		array(
			'amount'     => '500 g',
			'ingredient' => 'Roggenmehl',
		),
		array(
			'amount'     => '350 ml',
			'ingredient' => 'Wasser',
		),
	),
	'field_sections'        => array(
		array(
			'acf_fc_layout' => 'text_block',
			'text'          => '<p>Der Sauerteig braucht Zeit.</p>',
		),
		array(
			'acf_fc_layout' => 'quote',
			'quote'         => 'Brot ist Geduld.',
			'author'        => 'Anna',
		),
	),
	'field_short_text'      => 'Ein Brot für jeden Tag.',
	'field_location'        => array(
		'address' => 'Musterstraße 1, 1010 Wien',
		'lat'     => 48.2,
		'lng'     => 16.37,
	),
	'field_chef'            => $anna,
	'field_secret'          => 'made-up-code',
);
// Values are saved by field key, as the editor does: two groups have a field named subtitle.
foreach ( $values as $key => $value ) {
	update_field( $key, $value, $rye );
}
// A seamless clone with prefixed names: the editor posts its value under the clone's key joined
// with the cloned field's key, and it is stored as title_clone_subtitle.
update_field( 'field_title_clone', array( 'field_title_clone_field_post_subtitle' => 'Geklont' ), $rye );
update_field( 'field_local_origin', 'Waldviertel', $rye );
update_field( 'field_local_region', 'nord', $rye );
// A recipe with few values and an empty repeater.
update_field( 'field_subtitle', 'Für den Sonntag', $cake );
update_field( 'field_ingredients', array(), $cake );
update_field( 'field_seasonal', false, $cake );

update_field( 'field_post_subtitle', 'Neu im Shop', $book );
update_field( 'field_reading_time', 3, $book );
update_field( 'field_color', '#c08040', 'category_' . $bread_cat );
update_field( 'field_cat_icon', $oven, 'category_' . $bread_cat );

// update_field() changes post_modified, also of the images and files it attaches to the recipe,
// and field groups get the current time; keep the dates fixed.
foreach ( array( $rye, $cake, $book, $loaf, $crumb, $oven, $pdf ) as $id ) {
	fx_fix_modified( $id, get_post_field( 'post_date', $id ) );
}
$definitions = get_posts(
	array(
		'post_type'   => array( 'acf-field-group', 'acf-field' ),
		'post_status' => 'any',
		'numberposts' => -1,
		'fields'      => 'ids',
	)
);
foreach ( $definitions as $id ) {
	fx_fix_dates( $id, '2024-01-01 08:00:00' );
}

WP_CLI::success( 'custom-fields scenario created' );

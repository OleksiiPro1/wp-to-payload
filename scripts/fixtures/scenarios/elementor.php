<?php
/**
 * Title: Gartenbau Beispiel
 * Plugins: elementor@4.0.8
 *
 * Pages and a post built with Elementor's free widgets, saved through Elementor's own document
 * API as the editor does: sections with columns, inner sections and flexbox containers, and
 * every widget the import converts, plus free widgets it has no converter for. One page is made
 * with the elements of Elementor 4's editor, one has broken Elementor data, as
 * search-and-replace tools sometimes leave it. A plain page and a plain post show that content
 * without Elementor is not affected. All content is made up.
 */

require __DIR__ . '/../lib/fixtures.php';

update_option( 'blogdescription', 'Gärten in einer erfundenen Gärtnerei' );
// Elementor saves documents only for users who may edit them.
wp_set_current_user( 1 );

$garden  = fx_image( 'garten.png', array( 60, 140, 60 ), 900, 600, array( 'alt' => 'Ein Garten im Sommer' ) );
$pond    = fx_image( 'teich.png', array( 40, 90, 160 ), 600, 400, array( 'alt' => 'Ein Naturteich' ) );
$hedge   = fx_image( 'hecke.png', array( 30, 100, 40 ), 600, 400, array( 'alt' => 'Eine geschnittene Hecke' ) );
$portrait = fx_image( 'maria.png', array( 200, 160, 140 ), 300, 300, array( 'alt' => 'Maria Beispiel' ) );

$contact = fx_post(
	array(
		'post_type'    => 'page',
		'post_title'   => 'Kontakt',
		'post_name'    => 'kontakt',
		'post_date'    => '2024-01-02 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Schreiben Sie uns.</p>\n<!-- /wp:paragraph -->",
	)
);
$plain_post = fx_post(
	array(
		'post_title'   => 'Ohne Elementor',
		'post_name'    => 'ohne-elementor',
		'post_date'    => '2024-02-01 10:00:00',
		'post_content' => "<!-- wp:paragraph -->\n<p>Ein Beitrag aus dem Blockeditor.</p>\n<!-- /wp:paragraph -->",
	)
);

/** An Elementor element with a fixed ID, so the export is the same every time. */
function el( string $id, string $type, array $settings = array(), array $elements = array(), string $widget = '' ): array {
	$element = array(
		'id'       => $id,
		'elType'   => $type,
		'settings' => $settings,
		'elements' => $elements,
	);
	if ( $widget ) {
		$element['widgetType'] = $widget;
	}
	return $element;
}

function el_widget( string $id, string $widget, array $settings ): array {
	return el( $id, 'widget', $settings, array(), $widget );
}

function el_image( int $id ): array {
	return array(
		'id'     => $id,
		'url'    => wp_get_attachment_image_url( $id, 'full' ),
		'alt'    => '',
		'source' => 'library',
	);
}

function el_link( string $url, bool $external = false ): array {
	return array(
		'url'               => $url,
		'is_external'       => $external ? 'on' : '',
		'nofollow'          => '',
		'custom_attributes' => '',
	);
}

/** A page or post whose content is made with Elementor, saved as the editor saves it. */
function el_document( array $post, array $elements ): int {
	$id       = fx_post( $post + array( 'post_content' => '' ) );
	$document = \Elementor\Plugin::$instance->documents->get( $id );
	$document->set_is_built_with_elementor( true );
	if ( ! $document->save( array( 'elements' => $elements ) ) ) {
		fx_fail( "Elementor did not save {$post['post_title']}" );
	}
	fx_fix_modified( $id, $post['post_date'] );
	return $id;
}

$home = el_document(
	array(
		'post_type'  => 'page',
		'post_title' => 'Startseite',
		'post_name'  => 'startseite',
		'post_date'  => '2024-01-03 10:00:00',
	),
	array(
		el(
			'a100001',
			'section',
			array( 'layout' => 'boxed' ),
			array(
				el(
					'a110001',
					'column',
					array( '_column_size' => 50 ),
					array(
						el_widget(
							'a111001',
							'heading',
							array(
								'title'       => 'Gärten für Wien',
								'header_size' => 'h1',
							)
						),
						// The editor keeps paragraphs without tags; they are added when shown.
						el_widget( 'a111002', 'text-editor', array( 'editor' => "Wir planen und pflegen Gärten.\n\nSeit 1999 in <strong>Wien</strong>." ) ),
						el_widget(
							'a111003',
							'button',
							array(
								'text' => 'Angebot anfragen',
								'link' => el_link( get_permalink( $contact ) ),
							)
						),
					)
				),
				el(
					'a120001',
					'column',
					array( '_column_size' => 50 ),
					array(
						el_widget(
							'a121001',
							'image',
							array(
								'image'          => el_image( $garden ),
								'image_size'     => 'large',
								'caption_source' => 'custom',
								'caption'        => 'Ein Garten im Sommer',
							)
						),
					)
				),
			)
		),
		el(
			'b100001',
			'container',
			array( 'flex_direction' => 'row' ),
			array(
				el_widget(
					'b101001',
					'icon-list',
					array(
						'icon_list' => array(
							array(
								'_id'           => 'b101a01',
								'text'          => 'Planung',
								'selected_icon' => array(
									'value'   => 'fas fa-check',
									'library' => 'fa-solid',
								),
								'link'          => el_link( get_permalink( $contact ) ),
							),
							array(
								'_id'           => 'b101a02',
								'text'          => 'Pflege',
								'selected_icon' => array(
									'value'   => 'fas fa-check',
									'library' => 'fa-solid',
								),
							),
						),
					)
				),
				el_widget(
					'b102001',
					'image-box',
					array(
						'image'            => el_image( $pond ),
						'title_text'       => 'Teichbau',
						'description_text' => 'Naturteiche mit heimischen Pflanzen.',
						'link'             => el_link( get_permalink( $contact ) ),
					)
				),
				el_widget(
					'b103001',
					'icon-box',
					array(
						'title_text'       => 'Heckenschnitt',
						'description_text' => 'Zweimal im Jahr.',
						'title_size'       => 'h4',
					)
				),
			)
		),
		el(
			'c100001',
			'section',
			array(),
			array(
				el(
					'c110001',
					'column',
					array( '_column_size' => 100 ),
					array(
						el_widget(
							'c111001',
							'image-gallery',
							array(
								'wp_gallery' => array(
									array(
										'id'  => $garden,
										'url' => wp_get_attachment_image_url( $garden, 'full' ),
									),
									array(
										'id'  => $hedge,
										'url' => wp_get_attachment_image_url( $hedge, 'full' ),
									),
								),
							)
						),
						el_widget(
							'c111002',
							'video',
							array(
								'video_type'  => 'youtube',
								'youtube_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
							)
						),
						el_widget(
							'c111003',
							'testimonial',
							array(
								'testimonial_content' => 'Unser Garten blüht wie nie.',
								'testimonial_image'   => el_image( $portrait ),
								'testimonial_name'    => 'Maria Beispiel',
								'testimonial_job'     => 'Kundin',
							)
						),
						el_widget(
							'c111004',
							'accordion',
							array(
								'tabs' => array(
									array(
										'_id'         => 'c111a01',
										'tab_title'   => 'Was kostet eine Planung?',
										'tab_content' => '<p>Ab 300 Euro.</p>',
									),
									array(
										'_id'         => 'c111a02',
										'tab_title'   => 'Wie lange dauert es?',
										'tab_content' => '<p>Zwei Wochen.</p>',
									),
								),
							)
						),
						el_widget(
							'c111005',
							'toggle',
							array(
								'tabs' => array(
									array(
										'_id'         => 'c111b01',
										'tab_title'   => 'Pflegen Sie auch im Winter?',
										'tab_content' => 'Ja, den Winterschnitt.',
									),
								),
							)
						),
						el_widget(
							'c111006',
							'tabs',
							array(
								'tabs' => array(
									array(
										'_id'         => 'c111c01',
										'tab_title'   => 'Frühling',
										'tab_content' => '<p>Pflanzen.</p>',
									),
									array(
										'_id'         => 'c111c02',
										'tab_title'   => 'Herbst',
										'tab_content' => '<p>Laub rechen.</p>',
									),
								),
							)
						),
						el_widget( 'c111007', 'divider', array() ),
						el_widget( 'c111008', 'html', array( 'html' => '<p>Öffnungszeiten: <strong>Mo–Fr</strong></p><script>console.log("hi")</script>' ) ),
						el_widget( 'c111009', 'shortcode', array( 'shortcode' => '[contact-form-7 id="12" title="Anfrage"]' ) ),
						el_widget(
							'c111010',
							'alert',
							array(
								'alert_type'        => 'info',
								'alert_title'       => 'Hinweis',
								'alert_description' => 'Im Jänner haben wir geschlossen.',
							)
						),
						el_widget( 'c111011', 'spacer', array() ),
						// Free widgets without a converter.
						el_widget(
							'c111012',
							'counter',
							array(
								'ending_number' => 120,
								'title'         => 'Gärten',
							)
						),
						el_widget( 'c111013', 'google_maps', array( 'address' => 'Musterstraße 1, 1010 Wien' ) ),
						array(
							'isInner' => true,
						) + el(
							'c111014',
							'section',
							array(),
							array(
								el(
									'c111015',
									'column',
									array( '_column_size' => 100 ),
									array(
										el_widget(
											'c111016',
											'heading',
											array(
												'title'       => 'Besuchen Sie uns',
												'header_size' => 'h3',
												'link'        => el_link( get_permalink( $contact ) ),
											)
										),
									)
								),
							)
						),
					)
				),
			)
		),
	)
);

$spring = el_document(
	array(
		'post_title' => 'Frühlingsputz im Garten',
		'post_name'  => 'fruehlingsputz-im-garten',
		'post_date'  => '2024-03-01 10:00:00',
	),
	array(
		el(
			'd100001',
			'container',
			array(),
			array(
				el_widget( 'd101001', 'text-editor', array( 'editor' => '<p>Jetzt ist die Zeit für den Rückschnitt.</p>' ) ),
				el_widget(
					'd101002',
					'image',
					array(
						'image'   => el_image( $hedge ),
						'link_to' => 'file',
					)
				),
			)
		),
	)
);

// Broken Elementor data, as a search-and-replace across serialized data can leave it. Elementor
// shows nothing then; the HTML it stored in the content is still there.
$broken = el_document(
	array(
		'post_type'  => 'page',
		'post_title' => 'Über uns',
		'post_name'  => 'ueber-uns',
		'post_date'  => '2024-01-04 10:00:00',
	),
	array(
		el(
			'e100001',
			'container',
			array(),
			array(
				el_widget(
					'e101001',
					'heading',
					array(
						'title'       => 'Über uns',
						'header_size' => 'h2',
					)
				),
				el_widget( 'e101002', 'text-editor', array( 'editor' => '<p>Eine kleine Gärtnerei.</p>' ) ),
			)
		),
	)
);
update_post_meta( $broken, '_elementor_data', wp_slash( '[{"id":"e100001","elType":"container","settings":[],"elements":[{"id":"e101001"' ) );
fx_fix_modified( $broken, '2024-01-04 10:00:00' );

// A page made with the elements of Elementor 4's editor, whose settings are typed values
// ({"$$type": "string", "value": "…"}). They come last, so the IDs above stay the same.
function el_value( string $type, $value ): array {
	return array(
		'$$type' => $type,
		'value'  => $value,
	);
}
function el_html( string $html ): array {
	return el_value( 'html-v3', array( 'content' => el_value( 'string', $html ) ) );
}
$atomic    = fx_post(
	array(
		'post_type'    => 'page',
		'post_title'   => 'Leistungen',
		'post_name'    => 'leistungen',
		'post_date'    => '2024-01-05 10:00:00',
		'post_content' => '',
	)
);
$atomic_doc = \Elementor\Plugin::$instance->documents->get( $atomic );
$atomic_doc->set_is_built_with_elementor( true );
try {
	$atomic_doc->save(
		array(
			'elements' => array(
				el(
					'g100001',
					'e-flexbox',
					array(),
					array(
						el_widget(
							'g101001',
							'e-heading',
							array(
								'title' => el_html( 'Unsere <strong>Leistungen</strong>' ),
								'tag'   => el_value( 'string', 'h2' ),
							)
						),
						el_widget( 'g101002', 'e-paragraph', array( 'paragraph' => el_html( 'Planung, Pflege und Teichbau aus einer Hand.' ) ) ),
						el_widget(
							'g101003',
							'e-button',
							array(
								'text' => el_html( 'Zum Kontakt' ),
								'link' => el_value(
									'link',
									array(
										// An internal link names the page by ID.
										'destination'   => el_value( 'query', array( 'id' => el_value( 'number', $contact ) ) ),
										'isTargetBlank' => el_value( 'boolean', false ),
									)
								),
							)
						),
						el(
							'g102001',
							'e-div-block',
							array(),
							array(
								el_widget(
									'g102002',
									'e-image',
									array(
										'image' => el_value(
											'image',
											array(
												'src'  => el_value(
													'image-src',
													array(
														'id'  => el_value( 'image-attachment-id', $pond ),
														'url' => null,
													)
												),
												'size' => el_value( 'string', 'large' ),
											)
										),
									)
								),
								el_widget( 'g102003', 'e-divider', array() ),
								el_widget( 'g102004', 'e-youtube', array( 'source' => el_value( 'string', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' ) ) ),
								el_widget(
									'g102005',
									'e-paragraph',
									array(
										'paragraph' => el_html( 'Mehr auf unserem Blog.' ),
										'link'      => el_value(
											'link',
											array(
												'destination'   => el_value( 'url', 'https://example.org/gartenblog' ),
												'isTargetBlank' => el_value( 'boolean', true ),
											)
										),
									)
								),
							)
						),
					)
				),
			),
		)
	);
} catch ( \Throwable $e ) {
	// The data is saved first. Then Elementor renders the page to the plain text it keeps in the
	// post content, which for these elements needs the Twig copy of Elementor's release build;
	// built from Git, the plugin has none, so the content stays empty.
	if ( ! get_post_meta( $atomic, '_elementor_data', true ) ) {
		fx_fail( 'Elementor did not save the page Leistungen: ' . $e->getMessage() );
	}
}
fx_fix_modified( $atomic, '2024-01-05 10:00:00' );

// Elementor creates its default kit (global colours and fonts) with the current time.
$kits = get_posts(
	array(
		'post_type'   => 'elementor_library',
		'post_status' => 'any',
		'numberposts' => -1,
		'fields'      => 'ids',
	)
);
foreach ( $kits as $id ) {
	fx_fix_dates( $id, '2024-01-01 08:00:00' );
}

WP_CLI::success( 'elementor scenario created' );

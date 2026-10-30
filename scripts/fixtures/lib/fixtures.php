<?php
/**
 * Helpers for fixture scenarios, run with `wp eval-file`. Everything they create is synthetic.
 * Dates are fixed, so the export is the same on every run.
 */

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

function fx_fail( string $message ): void {
	WP_CLI::error( $message );
}

/** Sets post_modified, which WordPress always sets to the current time. */
function fx_fix_modified( int $id, string $date ): void {
	global $wpdb;
	$wpdb->update(
		$wpdb->posts,
		array(
			'post_modified'     => $date,
			'post_modified_gmt' => get_gmt_from_date( $date ),
		),
		array( 'ID' => $id )
	);
	clean_post_cache( $id );
}

/** Sets all four dates of an item that WordPress created with the current time. */
function fx_fix_dates( int $id, string $date ): void {
	global $wpdb;
	$wpdb->update(
		$wpdb->posts,
		array(
			'post_date'     => $date,
			'post_date_gmt' => get_gmt_from_date( $date ),
		),
		array( 'ID' => $id )
	);
	fx_fix_modified( $id, $date );
}

/** Creates a post, page or other item with fixed dates. Returns its ID. */
function fx_post( array $args ): int {
	$date     = $args['post_date'] ?? '2024-01-01 10:00:00';
	$modified = $args['post_modified'] ?? $date;
	unset( $args['post_modified'] );
	$id = wp_insert_post(
		array_merge(
			array(
				'post_type'     => 'post',
				'post_status'   => 'publish',
				'post_author'   => 1,
				'post_date'     => $date,
				'post_date_gmt' => get_gmt_from_date( $date ),
			),
			$args
		),
		true
	);
	if ( is_wp_error( $id ) ) {
		fx_fail( $id->get_error_message() );
	}
	fx_fix_modified( $id, $modified );
	return $id;
}

/** A term, with optional parent slug and term meta. Returns its ID. */
function fx_term( string $name, string $taxonomy, array $args = array(), array $meta = array() ): int {
	if ( isset( $args['parent_slug'] ) ) {
		$parent         = get_term_by( 'slug', $args['parent_slug'], $taxonomy );
		$args['parent'] = $parent ? $parent->term_id : 0;
		unset( $args['parent_slug'] );
	}
	$term = wp_insert_term( $name, $taxonomy, $args );
	if ( is_wp_error( $term ) ) {
		fx_fail( $term->get_error_message() );
	}
	foreach ( $meta as $key => $value ) {
		update_term_meta( $term['term_id'], $key, $value );
	}
	return (int) $term['term_id'];
}

/**
 * A solid-colour PNG in the media library, in the uploads folder of the given month. WordPress
 * creates the usual smaller sizes, and a "-scaled" copy for images wider than 2560 pixels.
 */
function fx_image( string $filename, array $rgb, int $width, int $height, array $args = array() ): int {
	$date = $args['date'] ?? '2024-01-01 09:00:00';
	$tmp  = wp_tempnam( $filename );
	$img  = imagecreatetruecolor( $width, $height );
	imagefill( $img, 0, 0, imagecolorallocate( $img, $rgb[0], $rgb[1], $rgb[2] ) );
	imagepng( $img, $tmp );
	imagedestroy( $img );

	// Passed by reference, so it must be a variable.
	$file   = array(
		'name'     => $filename,
		'tmp_name' => $tmp,
	);
	$upload = wp_handle_sideload(
		$file,
		array( 'test_form' => false ),
		substr( $date, 0, 4 ) . '/' . substr( $date, 5, 2 )
	);
	if ( isset( $upload['error'] ) ) {
		fx_fail( $upload['error'] );
	}
	$id = wp_insert_attachment(
		array(
			'post_mime_type' => $upload['type'],
			'post_title'     => $args['title'] ?? pathinfo( $filename, PATHINFO_FILENAME ),
			'post_excerpt'   => $args['caption'] ?? '',
			'post_content'   => $args['description'] ?? '',
			'post_status'    => 'inherit',
			'post_author'    => $args['author'] ?? 1,
			'post_date'      => $date,
			'post_date_gmt'  => get_gmt_from_date( $date ),
		),
		$upload['file'],
		$args['parent'] ?? 0,
		true
	);
	if ( is_wp_error( $id ) ) {
		fx_fail( $id->get_error_message() );
	}
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $upload['file'] ) );
	if ( ! empty( $args['alt'] ) ) {
		update_post_meta( $id, '_wp_attachment_image_alt', $args['alt'] );
	}
	fx_fix_modified( $id, $date );
	return $id;
}

/** An approved comment with a fixed date. */
function fx_comment( int $post_id, string $author, string $text, string $date ): int {
	return (int) wp_insert_comment(
		array(
			'comment_post_ID'      => $post_id,
			'comment_author'       => $author,
			'comment_author_email' => strtolower( preg_replace( '/\W+/', '.', $author ) ) . '@example.com',
			'comment_content'      => $text,
			'comment_approved'     => 1,
			'comment_date'         => $date,
			'comment_date_gmt'     => get_gmt_from_date( $date ),
		)
	);
}

/** A user who can write posts. The password is random and never exported. */
function fx_user( string $login, string $display_name, string $role = 'author' ): int {
	$id = wp_insert_user(
		array(
			'user_login'   => $login,
			'user_email'   => $login . '@example.com',
			'display_name' => $display_name,
			'first_name'   => explode( ' ', $display_name )[0],
			'last_name'    => explode( ' ', $display_name )[1] ?? '',
			'role'         => $role,
			'user_pass'    => wp_generate_password( 24 ),
		)
	);
	if ( is_wp_error( $id ) ) {
		fx_fail( $id->get_error_message() );
	}
	return (int) $id;
}

/** Adds an item to a navigation menu. Returns the menu item ID. */
function fx_menu_item( int $menu_id, array $args ): int {
	$id = wp_update_nav_menu_item( $menu_id, 0, array_merge( array( 'menu-item-status' => 'publish' ), $args ) );
	if ( is_wp_error( $id ) ) {
		fx_fail( $id->get_error_message() );
	}
	// Menu items get the current time; give them a fixed one.
	fx_fix_dates( (int) $id, '2024-01-01 08:00:00' );
	return (int) $id;
}

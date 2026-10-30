<?php
/**
 * Plugin Name: wp-to-payload fixture types
 * Description: A custom post type and taxonomy for the test fixtures of wp-to-payload.
 */

add_action(
	'init',
	function () {
		register_post_type(
			'recipe',
			array(
				'label'        => 'Recipes',
				'public'       => true,
				'has_archive'  => true,
				'rewrite'      => array( 'slug' => 'rezepte' ),
				'supports'     => array( 'title', 'editor', 'excerpt', 'thumbnail', 'author', 'custom-fields' ),
				'show_in_rest' => true,
			)
		);
		register_taxonomy(
			'recipe_category',
			'recipe',
			array(
				'label'        => 'Recipe categories',
				'hierarchical' => true,
				'public'       => true,
				'rewrite'      => array( 'slug' => 'rezeptkategorie' ),
				'show_in_rest' => true,
			)
		);
	}
);

<?php
// Belle Âme child theme
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_style('belleame', get_stylesheet_uri(), [], '1.0.0');
});

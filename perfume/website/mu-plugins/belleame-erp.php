<?php
/**
 * Plugin Name: Belle Âme ERP connection
 * Description: Shop settings for Oman and the visitor tracking used by the Belle Âme ERP marketing dashboard. Products, prices and offers are published from the ERP through the WooCommerce REST API.
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) exit;

const BELLEAME_ERP_URL = 'https://belleame.ample.run';

// One-time setup (runs once, then remembers it ran).
add_action('init', function () {
  if (get_option('belleame_setup_v1')) return;
  if (wp_get_theme('belleame')->exists() && get_stylesheet() !== 'belleame') switch_theme('belleame');
  update_option('blogname', 'Belle Âme');
  update_option('blogdescription', 'Luxury perfumes · Salalah, Oman');
  update_option('timezone_string', 'Asia/Muscat');
  update_option('permalink_structure', '/%postname%/');
  if (class_exists('WooCommerce')) {
    update_option('woocommerce_currency', 'OMR');
    update_option('woocommerce_price_num_decimals', 3);
    update_option('woocommerce_currency_pos', 'left_space');
    update_option('woocommerce_default_country', 'OM');
    update_option('woocommerce_allowed_countries', 'specific');
    update_option('woocommerce_specific_allowed_countries', ['OM']);
    update_option('woocommerce_calc_taxes', 'no'); // ERP prices already include VAT
    update_option('woocommerce_prices_include_tax', 'yes');
  }
  flush_rewrite_rules(false);
  update_option('belleame_setup_v1', gmdate('c'));
}, 99);

// Visitor tracking for the ERP marketing dashboard (random visitor id, no personal data).
add_action('wp_head', function () {
  if (is_admin()) return;
  if (function_exists('is_product') && is_product()) {
    global $post;
    $p = wc_get_product($post);
    if ($p) echo '<meta name="product-id" content="' . esc_attr($p->get_sku() ?: $post->post_name) . '">' . "\n";
  }
  echo '<script async src="' . esc_url(BELLEAME_ERP_URL . '/api/t.js') . '"></script>' . "\n";
});

// Reminder in WordPress admin until the ERP is connected.
add_action('admin_notices', function () {
  if (get_option('belleame_erp_connected') || !current_user_can('manage_options')) return;
  echo '<div class="notice notice-info"><p><b>Belle Âme ERP:</b> to let the ERP publish products, go to <a href="' . esc_url(admin_url('profile.php#application-passwords-section')) . '">Users → Profile → Application Passwords</a>, create one named “Belle Âme ERP”, and paste it in the ERP under Marketing → Connections → Website.</p></div>';
});
add_action('application_password_did_authenticate', function () { update_option('belleame_erp_connected', 1); });

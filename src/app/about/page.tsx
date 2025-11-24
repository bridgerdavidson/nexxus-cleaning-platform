import React from 'react';
import { Sparkles, Users, Award, Heart, Shield, Star, CheckCircle, Target, Eye, Zap } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-700 text-white py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center">
            <div className="inline-block px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-sm font-medium mb-6">
              ✨ About Nexxus Cleaning Solutions
            </div>
            <h1 className="text-5xl lg:text-6xl font-black mb-8 leading-tight">
              Cleaning Excellence<br />
              <span className="text-primary-400">Since Day One</span>
            </h1>
            <p className="text-xl text-gray-300 mb-10 leading-relaxed max-w-3xl mx-auto">
              We're more than just a cleaning service. We're your trusted partner in creating a healthier, 
              happier home environment for you and your family.
            </p>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-8">
                Our Story
              </h2>
              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                Founded in Phoenix, Arizona, Nexxus Cleaning Solutions was born from a simple belief: 
                everyone deserves a clean, healthy home without the stress and time commitment of doing it themselves.
              </p>
              <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                What started as a small local business has grown into the most trusted cleaning service 
                in the Phoenix metropolitan area. We've cleaned over 1,000 homes and built lasting 
                relationships with families who trust us with their most important space.
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
                Our commitment to excellence, eco-friendly practices, and customer satisfaction has 
                made us the go-to choice for busy professionals, growing families, and anyone who 
                values their time and peace of mind.
              </p>
            </div>
            <div className="relative">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 text-center">
                <div className="w-32 h-32 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-8">
                  <Sparkles className="w-16 h-16 text-primary-600" />
                </div>
                <h3 className="text-3xl font-bold text-slate-900 mb-4">1000+ Families</h3>
                <p className="text-gray-600 text-lg">Trust our cleaning services</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mission, Vision, Values */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">
              Our Foundation
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              The principles that guide everything we do
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center">
              <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <Target className="w-8 h-8 text-primary-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Our Mission</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                To provide exceptional cleaning services that give our customers more time to focus on 
                what matters most to them, while maintaining the highest standards of quality and trust.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <Eye className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Our Vision</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                To be the most trusted and reliable cleaning service in Arizona, known for our 
                professionalism, eco-friendly practices, and unwavering commitment to customer satisfaction.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-8">
                <Heart className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Our Values</h3>
              <p className="text-gray-600 text-lg leading-relaxed">
                Integrity, excellence, and respect guide every interaction. We treat every home as if 
                it were our own and every customer as part of our extended family.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">
              Why Choose Nexxus?
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              We're not just another cleaning service. Here's what sets us apart.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center mb-6">
                <Shield className="w-8 h-8 text-primary-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Fully Insured & Bonded</h3>
              <p className="text-gray-600 leading-relaxed">
                Your peace of mind is our priority. We're fully insured and bonded, so you can trust 
                us in your home with complete confidence.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mb-6">
                <Users className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Vetted Professionals</h3>
              <p className="text-gray-600 leading-relaxed">
                Every cleaner undergoes thorough background checks and training. We only work with 
                trusted professionals who share our commitment to excellence.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mb-6">
                <Award className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Quality Guarantee</h3>
              <p className="text-gray-600 leading-relaxed">
                Not satisfied? We'll make it right or your money back. Your satisfaction is our 
                guarantee, not just our goal.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mb-6">
                <Sparkles className="w-8 h-8 text-yellow-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Eco-Friendly Products</h3>
              <p className="text-gray-600 leading-relaxed">
                Safe for your family, pets, and the environment. We use only green, non-toxic 
                cleaning products that deliver exceptional results.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-6">
                <Zap className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">Flexible Scheduling</h3>
              <p className="text-gray-600 leading-relaxed">
                Life is busy. That's why we offer flexible scheduling options that work around your 
                schedule, including evenings and weekends.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl">
              <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-6">
                <Star className="w-8 h-8 text-indigo-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-4">5-Star Service</h3>
              <p className="text-gray-600 leading-relaxed">
                Our 4.9-star average rating speaks for itself. We consistently deliver the kind of 
                service that turns first-time customers into lifelong clients.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-black mb-6">
              Our Impact
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Numbers that tell our story
            </p>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-5xl font-black text-primary-400 mb-2">1000+</div>
              <div className="text-gray-300 font-medium text-lg">Homes Cleaned</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-black text-primary-400 mb-2">4.9</div>
              <div className="text-gray-300 font-medium text-lg">Average Rating</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-black text-primary-400 mb-2">50+</div>
              <div className="text-gray-300 font-medium text-lg">Professional Cleaners</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-black text-primary-400 mb-2">100%</div>
              <div className="text-gray-300 font-medium text-lg">Satisfaction Rate</div>
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-6">
              Meet Our Leadership
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              The passionate team behind Nexxus Cleaning Solutions
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center">
              <div className="w-24 h-24 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-primary-600 font-bold text-2xl">SJ</span>
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-2">Sarah Johnson</h3>
              <p className="text-primary-600 font-medium mb-4">Founder & CEO</p>
              <p className="text-gray-600 leading-relaxed">
                With over 10 years in the cleaning industry, Sarah founded Nexxus with a vision 
                to revolutionize home cleaning services in Arizona.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center">
              <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-green-600 font-bold text-2xl">MW</span>
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-2">Mike Wilson</h3>
              <p className="text-green-600 font-medium mb-4">Operations Manager</p>
              <p className="text-gray-600 leading-relaxed">
                Mike ensures every cleaning meets our high standards and manages our team of 
                professional cleaners across the Phoenix area.
              </p>
            </div>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 transition-all duration-300 hover:shadow-xl text-center">
              <div className="w-24 h-24 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-purple-600 font-bold text-2xl">EB</span>
              </div>
              <h3 className="text-2xl font-bold text-slate-900 mb-2">Emily Brown</h3>
              <p className="text-purple-600 font-medium mb-4">Customer Success</p>
              <p className="text-gray-600 leading-relaxed">
                Emily leads our customer success team, ensuring every client has an exceptional 
                experience from booking to completion.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl lg:text-5xl font-black text-slate-900 mb-8">
            Ready to Experience the Difference?
          </h2>
          <p className="text-xl text-gray-600 mb-10 max-w-3xl mx-auto">
            Join over 1,000 satisfied customers who trust Nexxus with their home cleaning needs
          </p>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <button className="bg-slate-900 text-white hover:bg-slate-800 font-bold py-4 px-10 rounded-lg transition-all duration-300 transform hover:scale-105 text-lg">
              Get A Quote Today
            </button>
            <button className="border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white font-bold py-4 px-10 rounded-lg transition-all duration-300 text-lg">
              Learn More
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
